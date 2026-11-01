// This module is not related with mongoDB is standalone in cache aches
// this is why the export from the caching is non camilCase following the semantics of the rest of the codebase
// is like this to have a little mindnote overhead so is non conn to the mongo

import helpFetch from "../../helpers/blizFetch-helpers/endpointFetchesBliz.js";
import getCache from "../../helpers/redis/getterRedis.js";
import setCache from "../../helpers/redis/setterRedis.js";

const hashName = "global_aches_non_rel";

/**
 * Shared achievement definition stored independently of the seasonal MongoDB catalog.
 *
 * @typedef {object} GlobalAchievementDefinition
 * @property {number|string} id Positive achievement ID.
 * @property {string} name Achievement name.
 * @property {string} description Achievement description.
 * @property {string} media HTTPS media URL.
 */

/** Standalone Redis cache for achievement definitions, keyed by achievement ID. */
const global_aches_non_rel = {
    /**
     * Validate and store an achievement definition in the shared Redis hash.
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

        return await setCache(id, achDoc, hashName);
    }, 
    /**
     * Read a cached definition, or fetch its definition and media from Blizzard and cache it.
     * Both the ID and an absolute HTTP/HTTPS URL are required, including on cache hits.
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

        const isValidHref = typeof href === "string" &&
            URL.canParse(href) &&
            ["http:", "https:"].includes(new URL(href).protocol);
        if (!isValidHref) {
            console.warn(`[${hashName}] getOne: href must be a valid HTTP or HTTPS link; received:`, href);
            return undefined;
        }

        let result = await getCache(id, hashName);
        if (result) return result;

        result = await helpFetch.fetchBlizzard(href);
        if (result) {
            result = {
                id,
                name: result.name,
                description: result.description,
                media: await helpFetch.getMedia(result, "media")
            }
            await global_aches_non_rel.setOne(result);
            return result;
        }

        console.warn(`[${hashName}] getOne: no achievement data returned for id ${id} from ${href}.`);
        return null
    }
};

export default global_aches_non_rel;
