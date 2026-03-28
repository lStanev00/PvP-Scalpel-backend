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
 * Validate one or many Redis list values without altering their casing.
 *
 * @param {string|string[]} values
 * @returns {string[]}
 */
function validateListValues(values) {
    const list = Array.isArray(values) ? values : [values];

    if (list.length === 0) {
        throw new TypeError("The values list cannot be empty!");
    }

    return list.map((value) => {
        value = checkKey(value);

        if (typeof value !== "string") {
            throw new TypeError("The value must be a string!");
        }

        return value;
    });
}

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

/**
 * Remove one or many lowercase string values from a Redis set key.
 *
 * @param {string} key
 * @param {string|string[]} values
 * @param {number} [clientIndex=0]
 * @returns {Promise<boolean>}
 */
export async function removeSetCache(key, values, clientIndex = 0) {
    const client = getRedisClient(clientIndex);

    try {
        key = checkKey(key);
        if (typeof key !== "string") throw new TypeError("The key must be a string!");

        const normalizedValues = normalizeSetValues(values);
        const deletedCount = await client.sRem(key, normalizedValues);

        return deletedCount > 0;
    } catch (error) {
        console.error(`[Redis Error] Failed to delete set values from "${key}":`, error);
        return false;
    }
}

/**
 * Remove one or many string values from a Redis list key.
 *
 * @param {string} key
 * @param {string|string[]} values
 * @param {number} [count=0]
 * @param {number} [clientIndex=0]
 * @returns {Promise<number|null>}
 */
export async function removeListCache(key, values, count = 0, clientIndex = 0) {
    const client = getRedisClient(clientIndex);

    try {
        key = checkKey(key);
        if (typeof key !== "string") throw new TypeError("The key must be a string!");
        if (typeof count !== "number") throw new TypeError("The count must be a number!");

        const validatedValues = [...new Set(validateListValues(values))];
        let deletedCount = 0;

        for (const value of validatedValues) {
            deletedCount += Number(await client.lRem(key, count, value));
        }

        return deletedCount;
    } catch (error) {
        console.error(`[Redis Error] Failed to delete list values from "${key}":`, error);
        return null;
    }
}

/**
 * Remove and return the first value from a Redis list key.
 *
 * @param {string} key
 * @param {number} [clientIndex=0]
 * @returns {Promise<string|null>}
 */
export async function shiftListCache(key, clientIndex = 0) {
    const client = getRedisClient(clientIndex);

    try {
        key = checkKey(key);
        if (typeof key !== "string") throw new TypeError("The key must be a string!");

        return await client.lPop(key);
    } catch (error) {
        console.error(`[Redis Error] Failed to shift list value from "${key}":`, error);
        return null;
    }
}

/**
 * Remove and return the last value from a Redis list key.
 *
 * @param {string} key
 * @param {number} [clientIndex=0]
 * @returns {Promise<string|null>}
 */
export async function popListCache(key, clientIndex = 0) {
    const client = getRedisClient(clientIndex);

    try {
        key = checkKey(key);
        if (typeof key !== "string") throw new TypeError("The key must be a string!");

        return await client.rPop(key);
    } catch (error) {
        console.error(`[Redis Error] Failed to pop list value from "${key}":`, error);
        return null;
    }
}
