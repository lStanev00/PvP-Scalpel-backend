import buildCharSearch from "./buildCharSearch.js";

/**
 * Normalize a raw character search string into the canonical `name:realm:server` form.
 *
 * Returns `undefined` when the input is not a string, does not contain exactly three
 * colon-delimited parts, or any normalized part is empty/invalid.
 *
 * @param {unknown} search
 * @returns {string | undefined}
 */
export default function normalizeCharacterSearch(search) {
    const searchParts = typeof search === "string" ? search.split(":") : [];

    if (searchParts.length !== 3) return undefined;

    return buildCharSearch(searchParts[2], searchParts[1], searchParts[0]);
}
