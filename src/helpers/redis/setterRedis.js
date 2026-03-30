import { getRedisClient } from "./connectRedis.js";
import checkKey from "./validateRedisKey.js";

/**
 * Normalize one or many Redis set values to lowercase strings.
 *
 * @param {string|string[]} values
 * @returns {string[]}
 */
function normalizeSetValues(values) {
    const list = Array.isArray(values) ? values : [values];

    if (list.length === 0) {
        throw new TypeError("The values list cannot be empty!");
    }

    return list.map((value) => {
        value = checkKey(value);

        if (typeof value !== "string") {
            throw new TypeError("The value must be a string!");
        }

        return value.toLowerCase();
    });
}

/**
 * Serialize one or many Redis list values while preserving input order.
 *
 * @param {unknown|unknown[]} values
 * @returns {string[]}
 */
function serializeListValues(values) {
    const list = Array.isArray(values) ? values : [values];

    if (list.length === 0) {
        throw new TypeError("The values list cannot be empty!");
    }

    return list.map((value) => {
        if (value === undefined) {
            throw new TypeError("Invalid value: undefined");
        }

        const serializedValue = JSON.stringify(value);

        if (typeof serializedValue !== "string") {
            throw new TypeError("The value must be JSON serializable!");
        }

        return serializedValue;
    });
}

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

/**
 * Add one or many lowercase string values to a Redis set key.
 *
 * @param {string} key
 * @param {string|string[]} values
 * @param {number} [ttl=-1]
 * @param {number} [clientIndex=0]
 * @returns {Promise<number|null>}
 */
export async function addSetCache(key, values, ttl = -1, clientIndex = 0) {
    if (typeof ttl !== "number") throw new TypeError("The ttl must be a number!");
    if (ttl !== -1 && ttl < 1) throw new RangeError("TTL must be positive or -1 (no expiry)!");

    const client = getRedisClient(clientIndex);

    try {
        key = checkKey(key);
        if (typeof key !== "string") throw new TypeError("The key must be a string!");

        const normalizedValues = normalizeSetValues(values);
        const success = await client.sAdd(key, normalizedValues);

        if (ttl !== -1) {
            await client.expire(key, ttl);
        }

        return success;
    } catch (error) {
        console.error(`[Redis Error] Failed to add set values to "${key}" ->`, error);
        return null;
    }
}

/**
 * Append one or many serializable values to the tail of a Redis list key.
 *
 * @param {string} key
 * @param {unknown|unknown[]} values
 * @param {number} [ttl=-1]
 * @param {number} [clientIndex=0]
 * @returns {Promise<number|null>}
 */
export async function pushListCache(key, values, ttl = -1, clientIndex = 0) {
    if (typeof ttl !== "number") throw new TypeError("The ttl must be a number!");
    if (ttl !== -1 && ttl < 1) throw new RangeError("TTL must be positive or -1 (no expiry)!");

    const client = getRedisClient(clientIndex);

    try {
        key = checkKey(key);
        if (typeof key !== "string") throw new TypeError("The key must be a string!");

        const serializedValues = serializeListValues(values);
        const success = await client.rPush(key, serializedValues);

        if (ttl !== -1) {
            await client.expire(key, ttl);
        }

        return Number(success);
    } catch (error) {
        console.error(`[Redis Error] Failed to append list values to "${key}" ->`, error);
        return null;
    }
}
