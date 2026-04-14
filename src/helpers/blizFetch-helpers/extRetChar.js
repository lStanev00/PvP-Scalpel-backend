import crypto from "node:crypto";
import { delay } from "../startBGTask.js";

/**
 * @typedef {object} ExtRetCharRatings
 * @property {number | null} blitzRecord - Highest Blitz rating reported by the external character API.
 * @property {number | null} SSRecord - Highest Solo Shuffle rating reported by the external character API.
 * @property {number | null} rbgRecord - Highest Rated Battleground rating reported by the external character API.
 * @property {number | null} twosRecord - Highest 2v2 rating reported by the external character API.
 * @property {number | null} threesRecord - Highest 3v3 rating reported by the external character API.
 */

/**
 * @typedef {object} PvPSummaryIdentity
 * @property {string} server - Region/server slug, for example `eu` or `us`.
 * @property {string} realm - Realm slug from the Blizzard PvP summary URL.
 * @property {string} name - Character name from the Blizzard PvP summary URL.
 */

const REALM_LOWERCASE_WORDS = new Set(["of", "and", "the"]);
const EXT_FUNCTION_KEY = "95$TXEgzTX15800__=";
const EXT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";
const EXT_REQUEST_TIMEOUT_MS = getPositiveNumberEnv("EXT_REQUEST_TIMEOUT_MS", 4000);
const EXT_REQUEST_DELAY_MS = getPositiveNumberEnv("EXT_REQUEST_DELAY_MS", 250);

function getPositiveNumberEnv(name, fallback) {
    const value = Number(process.env?.[name]);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function decodePathSegment(segment) {
    try {
        return decodeURIComponent(segment);
    } catch {
        return undefined;
    }
}

function titleCaseRealmWord(word, index) {
    const lowerWord = word.toLowerCase();
    if (index !== 0 && REALM_LOWERCASE_WORDS.has(lowerWord)) return lowerWord;
    return lowerWord.charAt(0).toUpperCase() + lowerWord.slice(1);
}

/**
 * Formats a realm slug/name for ext URL path usage.
 *
 * @param {string} realm - Realm slug, display name, or encoded display name.
 * @returns {string | undefined} Encoded display realm path segment, or `undefined` when invalid.
 */
export function formatExternalRealmPathSegment(realm) {
    if (typeof realm !== "string") return undefined;

    let decodedRealm;
    try {
        decodedRealm = decodeURIComponent(realm.trim());
    } catch {
        decodedRealm = realm.trim();
    }

    if (decodedRealm.length === 0) return undefined;

    const realmWords = decodedRealm.includes(" ")
        ? decodedRealm.split(/\s+/)
        : decodedRealm.split("-");

    const readableRealm = realmWords
        .filter((word) => word.length > 0)
        .map(titleCaseRealmWord)
        .join(" ");

    return readableRealm.length === 0 ? undefined : encodeURIComponent(readableRealm);
}

function formatExternalCharacterName(name) {
    if (typeof name !== "string") return undefined;

    const trimmedName = name.trim();
    if (trimmedName.length === 0) return undefined;

    const [firstChar, ...restChars] = Array.from(trimmedName);
    return encodeURIComponent(`${firstChar.toUpperCase()}${restChars.join("").toLowerCase()}`);
}

function extractRatings(data) {
    return {
        blitzRecord: data?.ratemaxblitz ?? null,
        SSRecord: data?.ratemaxshuffle ?? null,
        rbgRecord: data?.ratemaxrbg ?? null,
        twosRecord: data?.ratemax2v2 ?? null,
        threesRecord: data?.ratemax3v3 ?? null,
    };
}

function evpBytesToKey(password, salt, keyLength, ivLength) {
    const derivedBlocks = [];
    let block = Buffer.alloc(0);

    while (Buffer.concat(derivedBlocks).length < keyLength + ivLength) {
        block = crypto
            .createHash("md5")
            .update(Buffer.concat([block, Buffer.from(password), salt]))
            .digest();
        derivedBlocks.push(block);
    }

    const derived = Buffer.concat(derivedBlocks);
    return {
        key: derived.subarray(0, keyLength),
        iv: derived.subarray(keyLength, keyLength + ivLength),
    };
}

function encryptExtFunctionHeader(value) {
    const salt = crypto.randomBytes(8);
    const { key, iv } = evpBytesToKey(EXT_FUNCTION_KEY, salt, 32, 16);
    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);

    return Buffer.concat([Buffer.from("Salted__"), salt, encrypted]).toString("base64");
}

function buildExternalApiHeaders(apiPath, referer) {
    const delay = "0";
    const timestamp = Date.now() - Number(delay);

    return {
        accept: "application/json, text/plain, */*",
        "content-type": "application/json",
        authorization: "Bearer null",
        delay,
        function: encryptExtFunctionHeader(`${apiPath}|${timestamp}`),
        referer,
        "user-agent": EXT_USER_AGENT,
    };
}

async function fetchExternalCharacterApi(apiUrl, apiPath, referer) {
    let response;
    try {
        response = await fetch(apiUrl, {
            method: "GET",
            headers: buildExternalApiHeaders(apiPath, referer),
            signal: AbortSignal.timeout(EXT_REQUEST_TIMEOUT_MS),
        });
    } catch (error) {
        if (error?.name === "TimeoutError" || error?.name === "AbortError") {
            throw new Error(`ext direct character API timed out after ${EXT_REQUEST_TIMEOUT_MS}ms`);
        }

        throw new Error(`ext direct character API request failed: ${error.message}`);
    }

    if (response.status !== 200) {
        throw new Error(`ext direct character API returned ${response.status}`);
    }

    return extractRatings(await response.json());
}

/**
 * Parses a Blizzard character PvP summary URL into the identity needed by ext.
 *
 * @param {string} pvpSummaryPath - Blizzard PvP summary URL.
 * @returns {PvPSummaryIdentity | undefined} Parsed identity, or `undefined` when the URL is invalid.
 */
export function parsePvpSummaryPath(pvpSummaryPath) {
    if (typeof pvpSummaryPath !== "string") return undefined;

    let url;
    try {
        url = new URL(pvpSummaryPath);
    } catch {
        return undefined;
    }

    const hostMatch = url.hostname.match(/^(?<server>[^.]+)\.api\.blizzard\.com$/);
    if (!hostMatch?.groups?.server) return undefined;

    const pathParts = url.pathname.split("/").filter(Boolean);
    const [profile, wow, character, realm, name, summary] = pathParts;
    if (
        pathParts.length !== 6 ||
        profile !== "profile" ||
        wow !== "wow" ||
        character !== "character" ||
        summary !== "pvp-summary"
    ) {
        return undefined;
    }

    const server = hostMatch.groups.server;
    const namespace = url.searchParams.get("namespace");
    if (namespace && namespace !== `profile-${server}`) return undefined;

    const decodedRealm = decodePathSegment(realm);
    const decodedName = decodePathSegment(name);
    if (!decodedRealm || !decodedName) return undefined;

    return {
        server,
        realm: decodedRealm,
        name: decodedName,
    };
}

/**
 * Fetches the configured external character API using the same signed headers
 * generated by the ext client.
 *
 * @param {string} pvpSummaryPath - Blizzard PvP summary URL used to derive the external profile URL.
 * @returns {Promise<ExtRetCharRatings>} Captured external rating records.
 * @throws {Error} When the external character API request fails.
 */
export async function extRetChar(pvpSummaryPath) {
    const identity = parsePvpSummaryPath(pvpSummaryPath);
    if (!identity) throw new Error("extRetChar requires a valid Blizzard PvP summary URL.");

    const { name, realm, server } = identity;
    const EXT_DOMAIN = process.env.EXT_DOMAIN?.replace(/\/+$/, "");
    const safeRealm = formatExternalRealmPathSegment(realm);
    const safeName = formatExternalCharacterName(name);
    const safeServer = typeof server === "string" && server.trim().length > 0
        ? server.trim().toLowerCase()
        : undefined;

    if (!EXT_DOMAIN) throw new Error("EXT_DOMAIN is required for extRetChar.");
    if (!safeServer || !safeRealm || !safeName) {
        throw new Error("extRetChar requires non-empty server, realm, and name params.");
    }

    if (EXT_REQUEST_DELAY_MS > 0) await delay(EXT_REQUEST_DELAY_MS);
    const targetUrl = `${EXT_DOMAIN}/${safeServer}/${safeRealm}/${safeName}`;
    const apiPath = `characters/${safeServer}/${safeRealm}/${safeName}`;
    const apiUrl = `${EXT_DOMAIN}/api/${apiPath}`;

    return fetchExternalCharacterApi(apiUrl, apiPath, targetUrl);
}
