import { EventEmitter } from "node:events";
import { removeListCache } from "../../helpers/redis/deletersRedis.js";
import { listLengthCache, listValuesCache } from "../../helpers/redis/getterRedis.js";
import { pushListCache } from "../../helpers/redis/setterRedis.js";

const key = "CharQueue";
const humanReadableName = "Character Queue Cache";

/**
 * Normalize one queue value before using it against Redis.
 *
 * @param {string} value
 * @returns {string}
 */
function normalizeQueueValue(value) {
    if (typeof value !== "string") {
        throw new TypeError("Queue value must be a string.");
    }

    return value.toLowerCase();
}

export const CharQueueCacheEmitter = new EventEmitter();

CharQueueCacheEmitter.on("update", (msg) => console.log(`[${humanReadableName}] ${msg}`));
CharQueueCacheEmitter.on("error", (msg) => console.error(`[${humanReadableName} ERROR] ${msg}`));
CharQueueCacheEmitter.on("info", (msg) => console.info(`[${humanReadableName} INFO] ${msg}`));

/**
 * Read the queue from oldest queued value to newest queued value.
 *
 * @returns {Promise<string[]>}
 */
export async function getCharQueueMap() {
    return await listValuesCache(key);
}

/**
 * Check whether one normalized queue value already exists in the ordered queue.
 *
 * @param {string} value
 * @returns {Promise<boolean>}
 */
export async function getCharQueueEntry(value) {
    try {
        const normalizedValue = normalizeQueueValue(value);
        const values = await listValuesCache(key);

        return values.includes(normalizedValue);
    } catch (error) {
        CharQueueCacheEmitter.emit("error", `getCharQueueEntry invoked with invalid value: ${value}`);
        console.warn(error);
        return false;
    }
}

/**
 * Append one queue value to the global Redis list when it is not already queued.
 * Existing values stay in place so duplicate enqueue attempts are a no-op.
 *
 * @param {string} value
 * @param {number} [ttl=-1]
 * @returns {Promise<number|null>}
 */
export async function setCharQueueEntry(value, ttl = -1) {
    try {
        const normalizedValue = normalizeQueueValue(value);
        const values = await listValuesCache(key);

        if (values.includes(normalizedValue)) {
            return 0;
        }

        const result = await pushListCache(key, normalizedValue, ttl);

        if (result !== null) {
            CharQueueCacheEmitter.emit("update", `Just cached queue value: ${normalizedValue}`);
        }

        return result;
    } catch (error) {
        CharQueueCacheEmitter.emit("error", "setCharQueueEntry invoked with invalid params.");
        console.warn(error);
        return null;
    }
}

/**
 * Remove one queue value from the global Redis list.
 * If stale duplicates exist, all matching normalized values are removed.
 *
 * @param {string} value
 * @returns {Promise<boolean>}
 */
export async function deleteCharQueueEntry(value) {
    try {
        const normalizedValue = normalizeQueueValue(value);
        const deletedCount = await removeListCache(key, normalizedValue);
        const deleted = deletedCount !== null && deletedCount > 0;

        if (deleted) {
            CharQueueCacheEmitter.emit("info", `Deleted queue value: ${normalizedValue}`);
        }

        return deleted;
    } catch (error) {
        CharQueueCacheEmitter.emit("error", `deleteCharQueueEntry invoked with invalid value: ${value}`);
        console.warn(error);
        return false;
    }
}

/**
 * Read the current number of queued values.
 *
 * @returns {Promise<number>}
 */
export async function getCharQueueSize() {
    return await listLengthCache(key);
}
