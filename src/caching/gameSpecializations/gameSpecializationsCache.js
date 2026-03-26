import GameSpecialization from "../../Models/GameSpecialization.js";
import isPlainObject from "../../helpers/objectCheck.js";
import getCache from "../../helpers/redis/getterRedis.js";
import setCache from "../../helpers/redis/setterRedis.js";

const key = "game:specializations:list";
const ttlSeconds = 3600;
const numericIdPattern = /^\d+$/;

/**
 * Cached/read model shape for one game specialization entry.
 *
 * @typedef {object} GameSpecializationDoc
 * @property {number} _id
 * @property {string} name
 * @property {string} media
 * @property {"tank"|"damage"|"healer"} role
 * @property {number} relClass
 */

/**
 * Validate one cached or database specialization entry before exposing it.
 *
 * @param {unknown} entry
 * @returns {entry is GameSpecializationDoc}
 */
function isValidGameSpecialization(entry) {
    return (
        isPlainObject(entry) &&
        Number.isFinite(Number(entry._id)) &&
        typeof entry.name === "string" &&
        typeof entry.media === "string" &&
        typeof entry.role === "string" &&
        (entry.role === "tank" || entry.role === "damage" || entry.role === "healer") &&
        Number.isFinite(Number(entry.relClass))
    );
}

/**
 * Validate the list payload shape used by the Redis list key.
 *
 * @param {unknown} entries
 * @returns {entries is GameSpecializationDoc[]}
 */
function isValidGameSpecializationList(entries) {
    return Array.isArray(entries) && entries.every(isValidGameSpecialization);
}

/**
 * Normalize supported ID inputs to a numeric specialization ID.
 *
 * @param {number|string} id
 * @returns {number}
 */
function normalizeGameSpecializationId(id) {
    if (typeof id === "number" && Number.isInteger(id)) return id;

    if (typeof id === "string") {
        const trimmed = id.trim();
        if (numericIdPattern.test(trimmed)) return Number(trimmed);
    }

    throw new TypeError("id has to be an integer number or numeric string");
}

/**
 * Read the specialization list from MongoDB, keep ascending `_id` order, and drop malformed rows.
 *
 * @returns {Promise<GameSpecializationDoc[]>}
 */
async function fetchGameSpecializationsFromDB() {
    const gameSpecializations = await GameSpecialization.find().sort({ _id: 1 }).lean();

    if (!Array.isArray(gameSpecializations)) {
        throw new TypeError("GameSpecialization query must return an array");
    }

    const sanitizedGameSpecializations = gameSpecializations.filter(isValidGameSpecialization);
    if (sanitizedGameSpecializations.length !== gameSpecializations.length) {
        console.warn("[GameSpecializations Cache] Skipping invalid Mongo entries.");
    }

    return sanitizedGameSpecializations;
}

/**
 * Return the cached specialization list, rebuilding the single Redis list key on miss or bad payload.
 *
 * @returns {Promise<GameSpecializationDoc[]>}
 */
export async function getGameSpecializations() {
    try {
        /** @type {unknown} */
        const cachedGameSpecializations = await getCache(key);

        if (cachedGameSpecializations === null) {
            return await storeGameSpecializations();
        }

        if (isValidGameSpecializationList(cachedGameSpecializations)) {
            return cachedGameSpecializations;
        }

        console.warn("[GameSpecializations Cache] Invalid cached list payload. Rebuilding cache.");
        return await storeGameSpecializations();
    } catch (error) {
        console.error(error);
        return [];
    }
}

/**
 * Read one specialization from the cached list by ID.
 *
 * @param {number|string} id
 * @returns {Promise<GameSpecializationDoc|null>}
 */
export async function getGameSpecializationByID(id) {
    const normalizedId = normalizeGameSpecializationId(id);

    try {
        /** @type {GameSpecializationDoc[]} */
        const gameSpecializations = await getGameSpecializations();

        for (const entry of gameSpecializations) {
            if (entry._id === normalizedId) return entry;
        }

        return null;
    } catch (error) {
        console.error(error);
        return null;
    }
}

/**
 * Refresh the Redis list key from MongoDB and return the fresh ordered list.
 *
 * @returns {Promise<GameSpecializationDoc[]>}
 */
export async function storeGameSpecializations() {
    try {
        const gameSpecializations = await fetchGameSpecializationsFromDB();
        await setCache(key, gameSpecializations, "", ttlSeconds);
        return gameSpecializations;
    } catch (error) {
        console.error(error);
        return [];
    }
}
