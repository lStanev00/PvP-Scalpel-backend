import helpFetch from "../../helpers/blizFetch-helpers/endpointFetchesBliz.js";
import getCache from "../../helpers/redis/getterRedis.js";
import setCache from "../../helpers/redis/setterRedis.js";

const hashName = "global_titles_non_rel";
const maxAgeMs = 50 * 24 * 60 * 60 * 1000;
const pendingLookups = new Map();

/**
 * @typedef {Object} GlobalPvPTitle
 * @property {number} id - Blizzard PvP tier ID.
 * @property {number} fetchedAt - Fetch completion time in milliseconds.
 * @property {string} href - Blizzard PvP tier endpoint URL.
 * @property {string} name - English title name.
 * @property {string|null|undefined} media - Title media URL, when available.
 */

function isValidHref(href) {
    return typeof href === "string" && URL.canParse(href) &&
        ["http:", "https:"].includes(new URL(href).protocol);
}

function hasTitleData(title) {
    return typeof title?.name === "string" && title.name.trim().length > 0 &&
        isValidHref(title.media) && new URL(title.media).protocol === "https:";
}

/** Shared Redis title hash; entries are refreshed on access after 50 days. */
const global_titles_non_rel = {
    /**
     * Stores a complete title without applying Redis expiry to the hash.
     * @param {GlobalPvPTitle} titleDoc - Fetched title and cache metadata.
     * @returns {Promise<number|string|null|undefined>} Redis write result, or undefined for invalid data.
     */
    setOne: async (titleDoc) => {
        const id = Number(titleDoc?.id);
        if (!Number.isInteger(id) || id <= 0) {
            console.warn(`[${hashName}] setOne: id must be a positive integer; received:`, id);
            return undefined;
        }
        if (!isValidHref(titleDoc.href) || !hasTitleData(titleDoc)) {
            console.warn(`[${hashName}] setOne: a valid href, name, and HTTPS media URL are required.`);
            return undefined;
        }
        if (!Number.isFinite(titleDoc.fetchedAt) || titleDoc.fetchedAt <= 0 || titleDoc.fetchedAt > Date.now()) {
            console.warn(`[${hashName}] setOne: fetchedAt must be a valid fetch timestamp.`);
            return undefined;
        }

        const { fetchedAt, href, name, media } = titleDoc;
        return await setCache(id, { id, fetchedAt, href, name, media }, hashName);
    },

    /**
     * Returns a fresh cached title, or fetches and stores one before returning it.
     * Missing/invalid timestamps, different URLs, and ages of 50 days or more trigger a refresh.
     * Incomplete remote titles are returned without caching, preserving the fetcher's fallback.
     * @param {{id: number|string, href: string}} pseudoDoc - Tier ID and endpoint URL.
     * @returns {Promise<GlobalPvPTitle|undefined>} Title and metadata, or undefined if unavailable/invalid.
     */
    getOne: async (pseudoDoc) => {
        const id = Number(pseudoDoc?.id);
        const href = pseudoDoc?.href;
        if (!Number.isInteger(id) || id <= 0 || !isValidHref(href)) {
            console.warn(`[${hashName}] getOne: a positive integer id and HTTP/HTTPS href are required.`);
            return undefined;
        }

        // Include href so requests for different regions/namespaces cannot share a pending result.
        const pendingKey = `${id}:${href}`;
        if (pendingLookups.has(pendingKey)) return pendingLookups.get(pendingKey);

        const lookup = (async () => {
            const cached = await getCache(id, hashName);
            const ageMs = Date.now() - cached?.fetchedAt;
            if (Number(cached?.id) === id && cached?.href === href && hasTitleData(cached) &&
                Number.isFinite(cached.fetchedAt) && cached.fetchedAt > 0 &&
                ageMs >= 0 && ageMs < maxAgeMs) {
                return cached;
            }

            const title = await helpFetch.getPvPTitle(href);
            if (!title) return undefined;

            const result = { id, fetchedAt: Date.now(), href, name: title.name, media: title.media };
            // Never replace an existing entry or renew its age with an incomplete fetch.
            if (hasTitleData(result)) await global_titles_non_rel.setOne(result);
            return result;
        })();

        // Keep only pending requests in memory so completed lookups always check Redis age.
        pendingLookups.set(pendingKey, lookup);
        try {
            return await lookup;
        } finally {
            pendingLookups.delete(pendingKey);
        }
    },
};

export default global_titles_non_rel;
