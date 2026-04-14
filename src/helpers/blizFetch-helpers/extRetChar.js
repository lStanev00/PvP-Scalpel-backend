import puppeteer from "puppeteer";
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
 * Formats a realm slug/name for check-pvp URL path usage.
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

/**
 * Parses a Blizzard character PvP summary URL into the identity needed by check-pvp.
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
 * Opens the configured external character page and captures its same-origin
 * character API response without loading unnecessary assets.
 *
 * @param {string} pvpSummaryPath - Blizzard PvP summary URL used to derive the external profile URL.
 * @returns {Promise<ExtRetCharRatings>} Captured external rating records.
 * @throws {Error} When the browser cannot load the page or the character JSON is not captured before timeout.
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

    let browser;
    let context;
    let client;

    try {
        await delay(1500);
        browser = await puppeteer.launch({
            headless: true,
            defaultViewport: { width: 1, height: 1 },
            args: [
                "--disable-background-networking",
                "--disable-component-update",
                "--disable-default-apps",
                "--disable-extensions",
                "--disable-features=PrivacySandboxAdsAPIs,InterestCohort,AdInterestGroupAPI,Fledge,AttributionReporting,SharedStorageAPI,TopicsAPI",
                "--disable-gpu",
                "--disable-sync",
                "--mute-audio",
                "--no-default-browser-check",
                "--no-first-run",
                "--no-sandbox",
                "--disable-setuid-sandbox",
            ],
        });
        const TARGET_URL = `${EXT_DOMAIN}/${safeServer}/${safeRealm}/${safeName}`;
        const TARGET_ORIGIN = new URL(TARGET_URL).origin;
        const API_URL_PART = `${TARGET_ORIGIN}/api/characters/`;

        // Block resource classes that are not needed for API discovery and can increase RAM or tracking surface.
        const BLOCKED_RESOURCE_TYPES = new Set([
            "font",
            "image",
            "media",
            "stylesheet",
            "websocket",
            "eventsource",
            "ping",
            "prefetch",
            "manifest",
            "texttrack",
            "signedexchange",
            "cspviolationreport",
            "fedcm",
            "other",
        ]);
        const ALLOWED_RESOURCE_TYPES = new Set(["document", "script", "xhr", "fetch", "preflight"]);

        // Remove cookies and high-entropy client hints before same-origin requests leave the browser.
        const STRIPPED_REQUEST_HEADERS = new Set([
            "cookie",
            "sec-ch-ua-platform",
            "sec-ch-ua-platform-version",
            "sec-ch-ua-model",
            "sec-ch-ua-arch",
            "sec-ch-ua-bitness",
        ]);

        function isSameOrigin(url) {
            try {
                return new URL(url).origin === TARGET_ORIGIN;
            } catch {
                return false;
            }
        }

        function stripRequestHeaders(headers) {
            return Object.fromEntries(
                Object.entries(headers).filter(
                    ([name]) => !STRIPPED_REQUEST_HEADERS.has(name.toLowerCase()),
                ),
            );
        }

        // Use an isolated context so cookies/storage from other sessions are not reused.
        context = await browser.createBrowserContext();
        const page = await context.newPage();
        client = await page.target().createCDPSession();

        // Disable caches, service workers, and browser-side cookie access before navigation starts.
        await Promise.all([client.send("Network.enable")]);
        await Promise.all([
            client.send("Network.setCacheDisabled", { cacheDisabled: true }),
            client.send("Network.setBypassServiceWorker", { bypass: true }),
            client.send("Network.clearBrowserCookies"),
            client.send("Network.clearBrowserCache"),
            client.send("Network.setCookieControls", {
                enableThirdPartyCookieRestriction: true,
                disableThirdPartyCookieMetadata: true,
                disableThirdPartyCookieHeuristics: true,
            }),
            client.send("Emulation.setDocumentCookieDisabled", { disabled: true }),
        ]);

        await page.setRequestInterception(true);
        page.on("request", async (req) => {
            const resourceType = req.resourceType();

            // Keep only same-origin page/script/API traffic; drop ads, websockets, media, and unknown extras.
            if (
                !isSameOrigin(req.url()) ||
                BLOCKED_RESOURCE_TYPES.has(resourceType) ||
                !ALLOWED_RESOURCE_TYPES.has(resourceType)
            ) {
                await req.abort();
                return;
            }

            await req.continue({ headers: stripRequestHeaders(req.headers()) });
        });

        // Resolve as soon as the character API returns, then close the browser instead of rendering the page.
        const captured = new Promise((resolve, reject) => {
            const timeout = setTimeout(
                () => reject(new Error("Timed out waiting for character JSON")),
                60000,
            );
            let isCaptured = false;

            page.on("response", async (res) => {
                try {
                    if (isCaptured) return;

                    const url = res.url();
                    if (!url.includes(API_URL_PART)) return;
                    if (res.status() !== 200) return;

                    isCaptured = true;
                    const data = await res.json();
                    const ratings = {
                        blitzRecord: data?.ratemaxblitz ?? null,
                        SSRecord: data?.ratemaxshuffle ?? null,
                        rbgRecord: data?.ratemaxrbg ?? null,
                        twosRecord: data?.ratemax2v2 ?? null,
                        threesRecord: data?.ratemax3v3 ?? null,
                    };
                    clearTimeout(timeout);
                    resolve(ratings);
                } catch (error) {
                    clearTimeout(timeout);
                    reject(error);
                }
            });
        });

        const navigation = page.goto(TARGET_URL, {
            waitUntil: "domcontentloaded",
            timeout: 60000,
        });

        return await Promise.race([captured, navigation.then(() => captured)]);
    } catch (error) {
        console.error("Failed to capture JSON:", error);
        throw error;
    } finally {
        await client?.detach().catch(() => {});
        await context?.close().catch(() => {});
        await browser?.close();
    }
}
