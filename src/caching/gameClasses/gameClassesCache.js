import getCache, { hashGetAllCache } from "../../helpers/redis/getterRedis.js";
import setCache from "../../helpers/redis/setterRedis.js";
import GameClass from "../../Models/GameClass.js";
import updateGameClassAndSpecs from "../../services/updateGameClassAndSpecs.js";
import blizzardPvpClassSlug from "../../helpers/blizzardPvpClassSlug.js";

const hashKey = "game:classes:list";
const ttlSeconds = 3600;

/**
 * Cached/read model shape for one game class entry.
 *
 * @typedef {object} GameClassDoc
 * @property {number} _id
 * @property {string} name
 * @property {string} media
 * @property {unknown[]} [specs]
 */

/**
 * Refresh the Redis game class hash from MongoDB and return the cached list payload.
 *
 * @returns {Promise<GameClassDoc[]>}
 */
async function CacheGameClasses() {
    const dbClasses = await GameClass.find().lean();
    await Promise.all(
        dbClasses.map((classEntry) => setCache(classEntry._id, classEntry, hashKey, ttlSeconds)),
    );

    return dbClasses;
}

/**
 * Read one game class from the Redis hash by class ID.
 *
 * @param {number|string} id
 * @returns {Promise<GameClassDoc|null>}
 */
async function getById(id) {
    return await getCache(id, hashKey);
}

/**
 * Read all game classes from the Redis hash.
 *
 * @returns {Promise<GameClassDoc[]>}
 */
async function getCachedClasses() {
    try {
        return Object.values(await hashGetAllCache(hashKey));
    } catch (error) {
        console.error(error);
        return [];
    }
}

/**
 * Find a game class in a list by loose numeric ID equality.
 *
 * @param {GameClassDoc[]} entries
 * @param {number|string} id
 * @returns {GameClassDoc|undefined}
 */
function findClassById(entries, id) {
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) return undefined;

    return entries.find((entry) => Number(entry._id) === numericId);
}

function normalizeLookupName(name) {
    if (typeof name !== "string") return undefined;
    return name.trim().toLowerCase().replaceAll(" ", "");
}

function findClassByName(entries, name) {
    const trimmedName = name.trim();
    const normalizedSlug = trimmedName.toLowerCase();
    const normalizedName = normalizeLookupName(trimmedName);

    let exist = entries.find((entry) => entry.name === trimmedName);
    if (exist) return exist;

    exist = entries.find((entry) => blizzardPvpClassSlug(entry.name) === normalizedSlug);
    if (exist) return exist;

    return entries.find((entry) => normalizeLookupName(entry.name) === normalizedName);
}

/**
 * Read one game class by name, refreshing local and remote data on cache miss.
 *
 * @param {string} name
 * @returns {Promise<GameClassDoc|null>}
 */
async function getByName(name) {
    let cachedHash = await getCachedClasses();
    if (cachedHash.length === 0) cachedHash = await CacheGameClasses();

    let exist = findClassByName(cachedHash, name);
    if (exist) return exist;

    await updateGameClassAndSpecs();
    cachedHash = await CacheGameClasses();
    exist = findClassByName(cachedHash, name);

    if (exist) return exist;
    return null;
}

/**
 * Resolve a game class by ID or name from cache, MongoDB, and Blizzard fallback refreshes.
 *
 * @param {{ name?: string, id?: number|string }} params
 * @returns {Promise<GameClassDoc|null|undefined>}
 */
export async function getGameClass(params) {
    if (!params || typeof params !== "object") {
        console.warn(`getGameClasses invoked with bad params`);
        return undefined;
    }

    try {
        const {name} = params;
        const id = params.id !== undefined && params.id !== null
            ? normalizeGameClassId(params.id)
            : undefined;
        if (id !== undefined && id !== null) {
            // check if cached
            let exist = await getById(id);
            if (exist) return exist;

            // update from database and check if exist
            let cachedClasses = await CacheGameClasses();
            exist = findClassById(cachedClasses, id) ?? await getById(id);
            if (exist) return exist;

            // update from remote api, restores from database check if exist
            await updateGameClassAndSpecs();
            cachedClasses = await CacheGameClasses();
            exist = findClassById(cachedClasses, id) ?? await getById(id);
            if (exist) return exist;

            // return null if the class dont exist
            return null;
        } else if (typeof name === "string" && name.trim() !== "") {
            // check by name and see if exist
            return await getByName(name.trim());
        } else {
            console.warn(`getGameClasses invoked with bad params`);
            return undefined;
        }
    } catch (error) {
        console.error(error);
        return null;
    }
}


function normalizeGameClassId(id) {
    if (typeof id === "number" && Number.isInteger(id)) return id;
    const numericIdPattern = /^\d+$/;

    if (typeof id === "string") {
        const trimmed = id.trim();
        if (numericIdPattern.test(trimmed)) return Number(trimmed);
    }

    throw new TypeError("id has to be an integer number or numeric string");
}
