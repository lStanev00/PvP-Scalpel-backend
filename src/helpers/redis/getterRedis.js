import formReadableID from "../formReadableID.js";
import { getRedisClient } from "./connectRedis.js";
import checkKey from "./validateRedisKey.js";

/**
 * Validate one Redis set value input and keep the public helpers strict.
 *
 * @param {unknown} value
 * @returns {string}
 */
function validateSetValue(value) {
    value = checkKey(value);

    if (typeof value !== "string") {
        throw new TypeError("The value have to be a string!");
    }

    return value;
}

/**
 * Parse one stored Redis list entry back into its original JSON value.
 *
 * @param {string} value
 * @returns {any}
 */
function parseListValue(value) {
    try {
        return JSON.parse(value);
    } catch (error) {
        console.error(error);
        return value;
    }
}

export default async function getCache(key, hash = "", clientIndex = 0) {
    if (typeof hash !== "string") throw new TypeError("The hash have to be a string!");

    try {
        key = checkKey(key);
    } catch (error) {
        console.warn(error);
        return null;
    }

    if (typeof key !== "string") throw new TypeError("The key have to be a string!");

    const client = getRedisClient(clientIndex);
    let result;

    if (hash !== "") {
        result = await client
            .hGet(hash, key)
            .catch((reason) => console.info(`Redis Bug reason: ` + reason));
    } else {
        result = await client
            .get(key)
            .catch((reason) => console.info(`Redis Bug reason: ` + reason));
    }

    if (result === null) return null;

    if (!result && result !== null) {
        console.warn(result);
    } else {
        try {
            result = JSON.parse(result);
        } catch (error) {
            console.error(error);
        }
    }

    if (result._id) result._id = formReadableID(result._id);
    if (result.id) result.id = formReadableID(result.id);

    return result;
}

export async function hashGetAllCache(hash, clientIndex = 0) {
    const client = getRedisClient(clientIndex);

    if (!hash) throw new Error("Bad input");
    hash = checkKey(hash);
    if (typeof hash !== "string") throw new TypeError("The input must be type of string!");

    const result = await client.hGetAll(hash);
    const parsed = {};

    for (const [key, value] of Object.entries(result)) {
        try {
            parsed[key] = JSON.parse(value);
        } catch {
            parsed[key] = value; // fallback if not JSON
        }
    }

    return parsed;
}

/**
 * Read every string value from a Redis set key.
 *
 * @param {string} key
 * @param {number} [clientIndex=0]
 * @returns {Promise<string[]>}
 */
export async function setValuesCache(key, clientIndex = 0) {
    const client = getRedisClient(clientIndex);

    key = checkKey(key);
    if (typeof key !== "string") throw new TypeError("The key have to be a string!");

    const result = await client.sMembers(key);
    return Array.isArray(result) ? result : [];
}

/**
 * Check whether a Redis set key contains a specific string value.
 *
 * @param {string} key
 * @param {string} value
 * @param {number} [clientIndex=0]
 * @returns {Promise<boolean>}
 */
export async function setHasValueCache(key, value, clientIndex = 0) {
    const client = getRedisClient(clientIndex);

    key = checkKey(key);
    value = validateSetValue(value);

    if (typeof key !== "string") throw new TypeError("The key have to be a string!");

    const result = await client.sIsMember(key, value);
    return Boolean(result);
}

/**
 * Read the cardinality of a Redis set key.
 *
 * @param {string} key
 * @param {number} [clientIndex=0]
 * @returns {Promise<number>}
 */
export async function setCardCache(key, clientIndex = 0) {
    const client = getRedisClient(clientIndex);

    key = checkKey(key);
    if (typeof key !== "string") throw new TypeError("The key have to be a string!");

    const result = await client.sCard(key);
    return Number(result);
}

/**
 * Read ordered values from a Redis list key and parse their stored JSON payloads.
 *
 * @param {string} key
 * @param {number} [start=0]
 * @param {number} [end=-1]
 * @param {number} [clientIndex=0]
 * @returns {Promise<any[]>}
 */
export async function listValuesCache(key, start = 0, end = -1, clientIndex = 0) {
    const client = getRedisClient(clientIndex);

    key = checkKey(key);
    if (typeof key !== "string") throw new TypeError("The key have to be a string!");
    if (typeof start !== "number" || typeof end !== "number") {
        throw new TypeError("The start and end have to be numbers!");
    }

    const result = await client.lRange(key, start, end);
    return Array.isArray(result) ? result.map(parseListValue) : [];
}

/**
 * Read the length of a Redis list key.
 *
 * @param {string} key
 * @param {number} [clientIndex=0]
 * @returns {Promise<number>}
 */
export async function listLengthCache(key, clientIndex = 0) {
    const client = getRedisClient(clientIndex);

    key = checkKey(key);
    if (typeof key !== "string") throw new TypeError("The key have to be a string!");

    const result = await client.lLen(key);
    return Number(result);
}
