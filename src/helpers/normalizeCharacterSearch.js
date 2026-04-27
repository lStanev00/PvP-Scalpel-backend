import buildCharSearch from "./buildCharSearch.js";

const MISSING_SEARCH_PART = "!undefined";
const REGION_SLUGS = new Set(["eu", "us", "kr", "tw", "cn", "ru"]);

function parseColonSearch(search) {
    const parts = search.split(":").map((part) => part.trim());
    if (parts.length > 3) return undefined;

    return [
        parts[0],
        parts[1] || MISSING_SEARCH_PART,
        parts[2] || MISSING_SEARCH_PART,
    ];
}

function parseExplicitDashSearch(search) {
    const parts = search.split(/\s+-\s+/).map((part) => part.trim());
    if (parts.length > 3) return undefined;

    return [
        parts[0],
        parts[1] || MISSING_SEARCH_PART,
        parts[2] || MISSING_SEARCH_PART,
    ];
}

function parseRawDashSearch(search) {
    const parts = search.split("-").map((part) => part.trim()).filter(Boolean);
    if (parts.length === 0) return undefined;
    if (parts.length === 1) return [parts[0], MISSING_SEARCH_PART, MISSING_SEARCH_PART];

    const maybeServer = parts.at(-1).toLowerCase();
    const hasServer = REGION_SLUGS.has(maybeServer) || maybeServer === MISSING_SEARCH_PART;
    const realmEndIndex = hasServer ? -1 : parts.length;
    const realmParts = parts.slice(1, realmEndIndex);

    return [
        parts[0],
        realmParts.length > 0 ? realmParts.join("-") : MISSING_SEARCH_PART,
        hasServer ? parts.at(-1) : MISSING_SEARCH_PART,
    ];
}

function parseSearchParts(search) {
    const normalizedInput = search.trim();
    if (normalizedInput.length === 0) return undefined;
    if (normalizedInput.includes(":")) return parseColonSearch(normalizedInput);
    if (/\s+-\s+/.test(normalizedInput)) return parseExplicitDashSearch(normalizedInput);
    if (normalizedInput.includes("-")) return parseRawDashSearch(normalizedInput);

    return [normalizedInput, MISSING_SEARCH_PART, MISSING_SEARCH_PART];
}

/**
 * Normalize a raw character search string into the canonical `name:realm:server` form.
 *
 * Accepts the canonical `name:realm:server` form and webapp-style
 * `Name - Realm - Server` / `name-realm-server` searches.
 *
 * @param {unknown} search
 * @returns {string | undefined}
 */
export default function normalizeCharacterSearch(search) {
    const searchParts = typeof search === "string" ? parseSearchParts(search) : undefined;

    if (!searchParts) return undefined;

    return buildCharSearch({
        server: searchParts[2],
        realm: searchParts[1],
        name: searchParts[0],
    });
}
