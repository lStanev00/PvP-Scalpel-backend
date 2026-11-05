// This module is not related with mongoDB is standalone in cache aches
// this is why the export from the caching is non camilCase following the semantics of the rest of the codebase
// is like this to have a little mindnote overhead so is non conn to the mongo

import helpFetch from "../../helpers/blizFetch-helpers/endpointFetchesBliz.js";
import getCache from "../../helpers/redis/getterRedis.js";
import setCache from "../../helpers/redis/setterRedis.js";

const hashName = "global_aches_non_rel";
const maxAgeMs = 50 * 24 * 60 * 60 * 1000;
const pendingLookups = new Map();

function isValidHref(href) {
    return typeof href === "string" && URL.canParse(href) &&
        ["http:", "https:"].includes(new URL(href).protocol);
}

function hasDefinitionData(definition) {
    return typeof definition?.name === "string" && typeof definition.description === "string" &&
        typeof definition.media === "string" && definition.media.startsWith("https://");
}

/**
 * Shared achievement definition stored independently of the seasonal MongoDB catalog.
 *
 * @typedef {object} GlobalAchievementDefinition
 * @property {number|string} id Positive achievement ID.
 * @property {number} fetchedAt Fetch completion time in milliseconds.
 * @property {string} href Achievement definition endpoint URL.
 * @property {string} name Achievement name.
 * @property {string} description Achievement description.
 * @property {string} media HTTPS media URL.
 */

/** Standalone Redis achievement hash; definitions refresh on access after 50 days. */
const global_aches_non_rel = {
    /**
     * Validate and store an achievement definition without applying Redis expiry to the hash.
     *
     * @param {GlobalAchievementDefinition} achDoc Definition to cache; numeric string IDs are accepted.
     * @returns {Promise<number|null|undefined>} Redis write result, null on cache failure,
     * or undefined when a field fails validation.
     */
    setOne: async (achDoc) => {
        // every doc has to have name:String, Description: String, Media:link
        
        const { name, description, media } = achDoc;
        const id = Number(achDoc.id);

        if (!Number.isInteger(id) || id <= 0) {
            console.warn(`[${hashName}] setOne: id must be a positive integer; received:`, id);
            return undefined;
        }
        if (typeof name !== "string") {
            console.warn(`[${hashName}] setOne: name must be a string; received ${typeof name}.`);
            return undefined;
        }
        if (typeof description !== "string") {
            console.warn(`[${hashName}] setOne: description must be a string; received ${typeof description}.`);
            return undefined;
        }
        if (typeof media !== "string" || !(media.startsWith("https://"))) {
            console.warn(`[${hashName}] setOne: media must be a string starting with https://; received:`, media);
            return undefined;
        }

        if (!isValidHref(achDoc.href)) {
            console.warn(`[${hashName}] setOne: href must be a valid HTTP or HTTPS link.`);
            return undefined;
        }
        if (!Number.isFinite(achDoc.fetchedAt) || achDoc.fetchedAt <= 0 || achDoc.fetchedAt > Date.now()) {
            console.warn(`[${hashName}] setOne: fetchedAt must be a valid fetch timestamp.`);
            return undefined;
        }

        return await setCache(id, achDoc, hashName);
    }, 
    /**
     * Read a fresh definition, or fetch its definition and media from Blizzard and cache it.
     * Both the ID and an absolute HTTP/HTTPS URL are required, including on cache hits.
     * Missing/invalid timestamps, different URLs, and ages of 50 days or more trigger a refresh.
     *
     * @param {{id: number|string, href: string}} pseudoDoc Achievement ID and definition URL.
     * @returns {Promise<GlobalAchievementDefinition|null|undefined>} The definition,
     * null when no remote data is returned, or undefined for invalid input.
     * @throws {Error} If the cache lookup or remote request fails.
     */
    getOne: async (pseudoDoc) => {
        const id = Number(pseudoDoc?.id);
        const href = pseudoDoc?.href;

        if (!Number.isInteger(id) || id <= 0) {
            console.warn(`[${hashName}] getOne: id must be a positive integer; received:`, id);
            return undefined;
        }

        if (!isValidHref(href)) {
            console.warn(`[${hashName}] getOne: href must be a valid HTTP or HTTPS link; received:`, href);
            return undefined;
        }

        // Share pending definition/media requests only for the same ID and endpoint.
        const pendingKey = `${id}:${href}`;
        if (pendingLookups.has(pendingKey)) return pendingLookups.get(pendingKey);

        const lookup = (async () => {
            const cached = await getCache(id, hashName);
            const ageMs = Date.now() - cached?.fetchedAt;
            if (Number(cached?.id) === id && cached?.href === href && hasDefinitionData(cached) &&
                Number.isFinite(cached.fetchedAt) && cached.fetchedAt > 0 &&
                ageMs >= 0 && ageMs < maxAgeMs) {
                return cached;
            }

            let result = await helpFetch.fetchBlizzard(href);
            if (result) {
                const media = await helpFetch.getMedia(result, "media");
                result = {
                    id,
                    fetchedAt: Date.now(),
                    href,
                    name: result.name,
                    description: result.description,
                    media,
                };
                // Invalid/partial definitions never overwrite an older cached entry.
                await global_aches_non_rel.setOne(result);
                return result;
            }

            console.warn(`[${hashName}] getOne: no achievement data returned for id ${id} from ${href}.`);
            return null;
        })();

        pendingLookups.set(pendingKey, lookup);
        try {
            return await lookup;
        } finally {
            // Completed lookups must check Redis again so their age is always respected.
            pendingLookups.delete(pendingKey);
        }
    }
};

export default global_aches_non_rel;
