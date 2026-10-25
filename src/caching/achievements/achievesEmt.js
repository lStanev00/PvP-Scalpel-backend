import { EventEmitter } from "events";
import Achievement from "../../Models/Achievements.js";
import getCache, { hashGetAllCache } from "../../helpers/redis/getterRedis.js";
import setCache from "../../helpers/redis/setterRedis.js";
import toMap from "../../helpers/toMap.js";

const emitter = new EventEmitter();
emitter.on('update', () => console.info("[Achieves Cache] Achieves just got cached"));
const hashName = "Achievements";

/**
 * Plain achievement record serialized from the Achievement model into Redis.
 *
 * @typedef {object} CachedAchievement
 * @property {number} _id Achievement ID.
 * @property {string} [name]
 * @property {string} [href]
 * @property {string} [media]
 * @property {string} [description]
 * @property {number} [displayOrder]
 * @property {number} [category]
 * @property {number} [criteria]
 * @property {{name?: string, season?: number}} [expansion]
 * @property {boolean} isAccWide Defaults to false in the model.
 * @property {number} [__v] Mongoose document version.
 */

/**
 * Read all cached seasonal achievements from the Redis "Achievements" hash.
 *
 * Keys are achievement IDs stored as strings. Values are parsed JSON payloads,
 * with raw strings preserved when JSON parsing fails. An empty cache returns
 * an empty Map; this function does not populate the cache.
 *
 * @returns {Promise<Map<string, CachedAchievement | string>>} Cached achievement values keyed by ID.
 * @throws {Error} If the Redis read fails.
 */
export const getSeasonalIdsMap = async () => {
    const incomming = await hashGetAllCache(hashName);
    return toMap(incomming);
} 

export const getOneAchFromAchCache = async (key) => {
    if (typeof key == "number") key = key.toString();
    const get = await getCache(key, hashName);
    return get;
}

export async function setSeasonalIdsMap() {
    const newMap = await mapDBAchieves()

    if(newMap !== null){
        emitter.emit('update', newMap);
    }

}

export async function initialSetSeasonalIdsMap() {
    await mapDBAchieves()
}

export async function mapDBAchieves () {
    try {
        const dbList = await Achievement.find().lean();
        for (const entry of dbList) {

            await setCache(entry._id, entry, hashName)

        }

        return true
    } catch (error) {

        return null
    }
}