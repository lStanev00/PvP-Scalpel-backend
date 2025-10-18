import { getRedisClient } from "./connectRedis.js";

/**
 * Deletes a key or field from Redis.
 * 
 * @param {string} key - Key name or hash field to delete.
 * @param {string} [hash=""] - If provided, deletes field from this hash.
 * @param {number} [clientIndex=0] - Redis client (database index selector).
 * @returns {Promise<boolean>} 
 *   - true if one or more fields/keys were deleted
 *   - false if none deleted or error
 */
export default async function delCache(key, hash = "", clientIndex = 0) {
    if (typeof hash !== "string" || typeof key !== "string") {
        throw new TypeError("Both key and hash must be strings");
    }

    const client = getRedisClient(clientIndex);

    try {
        let deletedCount;

        if (hash) {
            deletedCount = await client.hDel(hash, key);
        } else {
            deletedCount = await client.del(key);
        }

        if (deletedCount > 0) {
            // Optionally log or emit here
            // console.info(`[Redis] Deleted ${deletedCount} entry from ${hash || key}`);
            return true;
        } else {
            // console.warn(`[Redis] Nothing found for deletion: ${hash ? `${hash}.${key}` : key}`);
            return false;
        }
    } catch (error) {
        console.error(`[Redis Error] Failed to delete "${key}" from "${hash || "root"}":`, error);
        return false;
    }
}
