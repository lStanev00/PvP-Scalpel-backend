import { EventEmitter } from "events";
import Region from "../../Models/Regions.js";
import isPlainObject from "../../helpers/objectCheck.js";
import setCache from "../../helpers/redis/setterRedis.js";
import { hashGetAllCache } from "../../helpers/redis/getterRedis.js";
import toMap from "../../helpers/toMap.js";

const emitter = new EventEmitter();
const hashName = "Regions";

/**
 * Loads all cached regions from Redis and converts them to a Map keyed by region id.
 *
 * @returns {Promise<Map<string, object>|null>} Cached regions map, or null when the cache is unavailable.
 */
export const getRegionIdsMap = async() => toMap(await hashGetAllCache(hashName));

/**
 * Finds a cached region by its slug.
 *
 * @param {string} searchSlug Region slug to search for.
 * @returns {Promise<[string, object]|undefined|null>} Matching map entry, undefined when not found,
 * or null when the cache is unavailable.
 */
export async function searchRegionFromMapBySlug(searchSlug) {
    if (typeof searchSlug !== "string") {
        console.warn(searchSlug + "'s not a string!");
        return undefined;
    }

    const result = await getRegionIdsMap();
    if (result === null) return null;

    const found = Array.from(result.entries()).find(([key, value]) => value.slug === searchSlug);

    if (!found) return undefined;
    return found;
}



/**
 * Rebuilds the region cache from the database and emits an update event when data was refreshed.
 *
 * @returns {Promise<void>}
 */
export async function setRegionIdsMap() {
    const newMap = await mapDBRegion()

    if(newMap !== null){
        // regionIdsMap = newMap;
        emitter.emit('update', newMap);
    }

}

/**
 * Performs the initial region cache build from the database.
 *
 * @returns {Promise<void>}
 */
export const initialSetRegionIdsMap = async() => await mapDBRegion();

/**
 * Registers the default region cache update logger.
 *
 * @returns {EventEmitter} Region cache event emitter.
 */
export const onRegionIdsUpdate = () => emitter.on('update', console.info("[Regions Cache] Regions just got cached"));

/**
 * Reads all regions from MongoDB, populates their realms, normalizes realm lists into Maps,
 * and stores each region in the Redis hash cache.
 *
 * @returns {Promise<void>}
 */
export async function mapDBRegion () {
    try {
        const dbList = await Region.find().populate("realms").lean();
        for (const entry of dbList) {

            const shadowRealmMap = new Map();
            
            if(entry.realms) {
                for (const realm of entry.realms) {
                    if (isPlainObject(realm)) shadowRealmMap.set(realm["_id"], realm);
                }
            }
            entry.realms = shadowRealmMap;
            await setCache(entry._id, entry, hashName);
        }
        return;
    } catch (error) {
        console.error(error);
    }
}
