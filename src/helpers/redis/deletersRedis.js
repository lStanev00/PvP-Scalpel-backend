import { redisCache } from "./connectRedis.js";

export default async function delCache(key, hash = "") {
    if (typeof hash !== "string" || typeof key !== "string")
        throw new TypeError("Both key and hash must be strings");

    try {
        const deleted = hash
            ? await redisCache.hDel(hash, key)
            : await redisCache.del(key);

        return deleted > 0;
    } catch (error) {
        console.error(`Error deleting field "${key}" from hash "${hash}":`, error);
        return false;
    }
}
