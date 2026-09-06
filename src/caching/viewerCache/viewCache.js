import delCache from "../../helpers/redis/deletersRedis.js";
import getCache from "../../helpers/redis/getterRedis.js";
import setCache from "../../helpers/redis/setterRedis.js";
import crypto from "crypto";

const mapHashKey = "viewCache";

/**
 * Gets a document's string ID, preferring its virtual `id` over `_id`.
 *
 * @param {{id?: {toString(): string}, _id: {toString(): string}}} doc - Document with an ID.
 * @returns {string} The document ID as a string.
 */
const getDocId = (doc) => (doc.id ? doc.id : doc._id).toString();

const viewCache = {
    /**
     * Gets the cached view data for the current viewer.
     *
     * Authenticated viewers are keyed by user ID; anonymous viewers are keyed
     * by a hash derived from the request.
     *
     * @param {import("express").Request} req - Request identifying the viewer.
     * @returns {Promise<{id: string, viewedAt: number}|null>} The cached view data, or `null` when none exists.
     */
    getViewCache: async (req) => {
        const userID = req?.user?._id;
        const getData = (id) => getCache(id, mapHashKey);

        if (userID) {
            return await getData(userID);
        } else {
            const hash = getViewerHash(req);
            return await getData(hash);
        }
    },
    /**
     * Caches a document ID and view timestamp for the current viewer.
     *
     * Authenticated viewers are keyed by user ID; anonymous viewers are keyed
     * by a hash derived from the request.
     *
     * @param {import("express").Request} req - Request identifying the viewer.
     * @param {{id?: string, _id: {toString(): string}}} doc - Viewed document.
     * @param {number} [ttl=20] - Cache lifetime in seconds.
     * @returns {Promise<number|string|null>} Redis write result.
     */
    setViewCache: async (req, doc, ttl = 20) => {
        const userID = req?.user?._id;

        const viewData = { id: getDocId(doc), viewedAt: Date.now() };
        const setData = (id) => setCache(id, viewData, mapHashKey, ttl);

        if (userID) {
            return await setData(userID);
        } else {
            const hash = getViewerHash(req);
            return await setData(hash);
        }
    },
    /**
     * Deletes the cached viewed document ID for the current viewer.
     *
     * Authenticated viewers are keyed by user ID; anonymous viewers are keyed
     * by a hash derived from the request.
     *
     * @param {import("express").Request} req - Request identifying the viewer.
     * @returns {Promise<boolean>} `true` when a cache entry was deleted.
     */
    delViewCache: async (req) => {
        const userID = req?.user?._id;
        const delData = (id) => delCache(id, mapHashKey);

        if (userID) {
            return await delData(userID);
        } else {
            const hash = getViewerHash(req);
            return await delData(hash);
        }
    },
};

/**
 * Creates a stable anonymous-viewer cache key from request fingerprint headers.
 *
 * @param {import("express").Request} req - Request supplying IP and client headers.
 * @returns {string} SHA-256 HMAC hash for the viewer.
 */
function getViewerHash(req) {
    const ip = req.headers["cf-connecting-ip"] || req.ip || "";

    const data = [
        ip,
        req.headers["cf-ipcountry"] || "",
        req.headers["user-agent"] || "",
        req.headers["sec-ch-ua"] || "",
        req.headers["sec-ch-ua-platform"] || "",
        req.headers["sec-ch-ua-mobile"] || "",
    ].join("|");

    return crypto.createHmac("sha256", process.env.CLIENT_SECRET).update(data).digest("hex");
}

/**
 * Determines whether a viewer has not recently viewed a document.
 *
 * The document ID is stored for the viewer before the result is returned.
 * Returns `false` only when the cached ID matches the supplied document and
 * fewer than 20 seconds have passed since the cached view.
 *
 * @param {import("express").Request} req - Request identifying the viewer.
 * @param {{id?: {toString(): string}, _id: {toString(): string}}} doc - Viewed document.
 * @returns {Promise<boolean>} Whether this view should increment the document's view count.
 */
export default async function shouldBumpViews(req, doc) {
    const docId = getDocId(doc);

    const existInCache = await viewCache.getViewCache(req);
    await viewCache.setViewCache(req, doc);

    const viewed = existInCache
        ? existInCache.id === docId && Date.now() - existInCache.viewedAt < 20_000
        : false;

    return !viewed;
}
