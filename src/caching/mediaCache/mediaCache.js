import MediaMeta from "../../Models/MediaMeta.js";
import delCache from "../../helpers/redis/deletersRedis.js";
import getCache from "../../helpers/redis/getterRedis.js";
import setCache from "../../helpers/redis/setterRedis.js";

const hashKey = "media:data";
const ttl = 7200;

/** @typedef {import("../../Models/types/MediaMeta.types.d.ts").MediaMetaDocument} MediaMetaDocument */

/**
 * @param {MediaMetaDocument} mongooseDoc
 * @returns {Promise<boolean>} `true` when cached, otherwise `false`.
 * @throws {TypeError} When the input is not a MediaMeta document.
 * @throws {import("mongoose").Error.ValidationError} When schema validation fails.
 */
export async function cacheMedia(mongooseDoc) {
    /** @type {MediaMetaDocument | null} */
    const mediaDoc = await validateMediaDoc(mongooseDoc);

    if (!mediaDoc) return false;

    const result = await setCache(mediaDoc._id.toString(), mediaDoc.toObject(), hashKey, ttl);

    if (result === null) {
        return false;
    }
    console.info(`media with id ${mediaDoc._id} just has been cached`);

    return true;
}

/**
 * Looks up media metadata from Redis first, then falls back to MongoDB by `_id`.
 *
 * When MongoDB returns a document, the document is cached before it is returned.
 * Cache lookup failures or database errors are logged and normalized to `null`.
 *
 * @param {string} key MediaMeta document id.
 * @returns {Promise<MediaMetaDocument | Record<string, unknown> | null>} Cached plain object,
 * MongoDB document, or `null` when no media metadata is found or lookup fails.
 */
export const getMediaCache = async (key) => {
    try {
        const cached = await getCache(key, hashKey);
        if(cached) return cached;
        
        const doc = await MediaMeta.findById(key);

        if (doc) await cacheMedia(doc);

        return doc;

    } catch (error) {
        console.warn(error);
        return null;
    }
}
export const finalizeUploadCache = async (key) => await delCache(key, hashKey);

/**
 * @param {unknown} doc
 * @returns {Promise<MediaMetaDocument | null>}
 */
async function validateMediaDoc(doc) {
    if (!(doc instanceof MediaMeta)) {
        console.warn("Expected a MediaMeta Mongoose document");
        return null;
    }

    await doc.validate();
    return doc;
}
