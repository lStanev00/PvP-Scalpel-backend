import { EventEmitter } from "events";
import { hashGetAllCache } from "../../helpers/redis/getterRedis.js";
import setCache from "../../helpers/redis/setterRedis.js";
import pullDownloadUrlForApp from "./CDN/pullDownloadURL.js";

const hashName = "cdn:download";

const emitter = new EventEmitter();
emitter.on("update", (key) =>
    console.info(`[${hashName} Cache] ${key} just got cached`)
);

/**
 * Normalize a TTL or expiry value to seconds.
 * Accepts seconds or a date string; returns -1 when invalid or missing.
 * @param {number|string|undefined|null} value
 * @returns {number}
 */
const toTtlSeconds = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.max(1, Math.floor(value));
    }

    if (typeof value === "string" && value.trim() !== "") {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) return Math.max(1, Math.floor(numeric));

        const parsed = Date.parse(value);
        if (!Number.isNaN(parsed)) {
            const diffSeconds = Math.floor((parsed - Date.now()) / 1000);
            if (diffSeconds > 0) return diffSeconds;
        }
    }

    return -1;
};

/**
 * Derive TTL seconds from the presign response.
 * @param {{expiresIn?: number|string}|null} download
 * @returns {number}
 */
const extractTtlSeconds = (download) => {
    return toTtlSeconds(download?.expiresIn);
};

/**
 * Fetch the full download cache hash.
 * @returns {Promise<Record<string, any>>}
 */
export const getDownloadMap = async () => await hashGetAllCache(hashName);

/**
 * Fetch a fresh presigned download URL entry and update the cache.
 * @param {"addon"|"desktop"|"launcher"} targetKey
 * @returns {Promise<{version: string, url: string, expiresIn: number}|null>}
 */
export async function getDownloadUrl(targetKey) {
    try {
        const fresh = await storeDownloadUrl(targetKey);
        if (fresh) return fresh;

        return null;
    } catch (error) {
        console.error(error);
        return null;
    }
}

/**
 * Fetch and store a presigned download URL entry in the hash cache.
 * The TTL is applied to the entire hash.
 * @param {"addon"|"desktop"|"launcher"} targetKey
 * @returns {Promise<{version: string, url: string, expiresIn: number}|null>}
 */
export async function storeDownloadUrl(targetKey) {
    try {
        const download = await pullDownloadUrlForApp(targetKey);
        if (!download) return null;

        const ttl = extractTtlSeconds(download);
        await setCache(targetKey, download, hashName, ttl);
        emitter.emit("update", targetKey);

        return download;
    } catch (error) {
        console.error(error);
        return null;
    }
}
