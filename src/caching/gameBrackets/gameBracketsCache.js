import GameBrackets from "../../Models/GameBrackets.js";
import isPlainObject from "../../helpers/objectCheck.js";
import getCache from "../../helpers/redis/getterRedis.js";
import setCache from "../../helpers/redis/setterRedis.js";

const key = "game:brackets:list";
const ttlSeconds = 3600;
const numericIdPattern = /^\d+$/;

/**
 * @typedef {Object} GameBracketDoc
 * @property {number|string} _id
 * @property {string} name
 * @property {boolean} isRated
 * @property {boolean} isSolo
 */

/**
 * Validate one cached or database bracket entry before exposing it.
 * The check is intentionally strict because the cache stores the full list under one key.
 *
 * @param {unknown} entry
 * @returns {entry is GameBracketDoc}
 */
function isValidGameBracket(entry) {
    return (
        isPlainObject(entry) &&
        Number.isFinite(Number(entry._id)) &&
        typeof entry.name === "string" &&
        typeof entry.isRated === "boolean" &&
        typeof entry.isSolo === "boolean"
    );
}

/**
 * Validate the list payload shape used by the Redis list key.
 *
 * @param {unknown} entries
 * @returns {entries is GameBracketDoc[]}
 */
function isValidGameBracketList(entries) {
    return Array.isArray(entries) && entries.every(isValidGameBracket);
}

/**
 * Normalize supported ID inputs to a numeric bracket ID.
 *
 * @param {number|string} id
 * @returns {number}
 */
function normalizeGameBracketId(id) {
    if (typeof id === "number" && Number.isInteger(id)) return id;

    if (typeof id === "string") {
        const trimmed = id.trim();
        if (numericIdPattern.test(trimmed)) return Number(trimmed);
    }

    throw new TypeError("id has to be an integer number or numeric string");
}

/**
 * Read the bracket list from MongoDB, keep ascending `_id` order, and drop malformed rows.
 * This list is tiny reference data, so one full ordered read is cheaper than maintaining
 * extra cache structures or per-entry invalidation logic.
 *
 * @returns {Promise<GameBracketDoc[]>}
 */
async function fetchGameBracketsFromDB() {
    const gameBrackets = await GameBrackets.find().sort({ _id: 1 }).lean();

    if (!Array.isArray(gameBrackets)) {
        throw new TypeError("GameBrackets query must return an array");
    }

    const sanitizedGameBrackets = gameBrackets.filter(isValidGameBracket);
    if (sanitizedGameBrackets.length !== gameBrackets.length) {
        console.warn("[GameBrackets Cache] Skipping invalid Mongo entries.");
    }

    return sanitizedGameBrackets;
}

/**
 * Return the cached bracket list, rebuilding the single Redis list key on miss or bad payload.
 *
 * @returns {Promise<GameBracketDoc[]|undefined>}
 */
export async function getGameBrackets() {
    try {
        const cachedGameBrackets = await getCache(key);

        if (cachedGameBrackets === null) {
            return await storeGameBrackets();
        }

        if (isValidGameBracketList(cachedGameBrackets)) {
            return cachedGameBrackets;
        }

        console.warn("[GameBrackets Cache] Invalid cached list payload. Rebuilding cache.");
        return await storeGameBrackets();
    } catch (error) {
        console.error(error);
    }
}

/**
 * Read one bracket from the cached list by ID.
 * This is an O(n) scan over a very small reference dataset, which is cheaper and simpler
 * than keeping a second by-id cache in sync.
 *
 * @param {number|string} id
 * @returns {Promise<GameBracketDoc|null|undefined>}
 */
export async function getGameBracketByID(id) {
    const normalizedId = normalizeGameBracketId(id);

    try {
        const gameBrackets = await getGameBrackets();
        if (!Array.isArray(gameBrackets)) return null;

        for (const entry of gameBrackets) {
            if (Number(entry._id) === normalizedId) return entry;
        }

        return null;
    } catch (error) {
        console.error(error);
    }
}

/**
 * Refresh the Redis list key from MongoDB and return the fresh ordered list.
 *
 * @returns {Promise<GameBracketDoc[]|undefined>}
 */
export async function storeGameBrackets() {
    try {
        const gameBrackets = await fetchGameBracketsFromDB();
        await setCache(key, gameBrackets, "", ttlSeconds);
        return gameBrackets;
    } catch (error) {
        console.error(error);
    }
}
