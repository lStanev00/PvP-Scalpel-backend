import { getRedisClient } from "./connectRedis.js";
import checkKey from "./validateRedisKey.js";

/**
 * Uploads an entry to Redis (supports direct key or hash mode)
 * 
 * @param {string} key - Key name or hash field.
 * @param {any} value - Serializable value to store.
 * @param {string} [hash=""] - If provided, stores key inside a hash.
 * @param {number} [ttl=-1] - TTL in seconds (-1 means no expiration).
 * @param {number} [clientIndex=0] - Redis client (DB index selector).
 * @returns {Promise<number|string|null>} 
 *   - success integer (1 for new field, 0 for replaced)
 *   - "OK" for normal key set
 *   - null on validation failure
 */
export default async function setCache(key, value, hash = "", ttl = -1, clientIndex = 0) {
    if (typeof hash !== "string") throw new TypeError("The hash must be a string!");
    if (typeof ttl !== "number") throw new TypeError("The ttl must be a number!");
    if (ttl !== -1 && ttl < 1) throw new RangeError("TTL must be positive or -1 (no expiry)!");
    if (value === undefined) throw new TypeError("Invalid value: undefined");

    const client = getRedisClient(clientIndex);
    let success;

    try {
        key = checkKey(key);
        if (typeof key !== "string") throw new TypeError("The key must be a string!");

        const serializedValue = JSON.stringify(value);

        if (hash) {
            // Set inside a hash
            success = await client.hSet(hash, key, serializedValue);

            // Apply TTL to the hash key (entire hash)
            if (ttl !== -1) {
                await client.expire(hash, ttl);
            }
        } else {
            // Set as a direct key
            if (ttl !== -1) {
                success = await client.set(key, serializedValue, { EX: ttl });
            } else {
                success = await client.set(key, serializedValue);
            }
        }

        if (success === undefined || success === null) {
            console.warn(`[Redis Warning] Unexpected result for key "${key}"`);
        }

        return success;
    } catch (error) {
        console.error(`[Redis Error] Failed to set key "${key}" →`, error);
        return null;
    }
}
