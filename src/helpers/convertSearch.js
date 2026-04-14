import normalizeCharacterSearch from "./normalizeCharacterSearch.js";

/**
 * Splits a character search key into canonical `[name, realm, server]` parts.
 *
 * @param {unknown} search - Raw `name:realm:server` search string.
 * @returns {[string, string, string] | undefined} Canonical parts, or `undefined` if invalid.
 */
export default function convertSearch(search) {
    const normalizedSearch = normalizeCharacterSearch(search);
    if (!normalizedSearch) return undefined;

    return normalizedSearch.split(":");
}
