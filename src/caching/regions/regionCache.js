import { EventEmitter } from "events";
import Region from "../../Models/Regions.js";
import isPlainObject from "../../helpers/objectCheck.js";
import setCache from "../../helpers/redis/setterRedis.js";
import { hashGetAllCache } from "../../helpers/redis/getterRedis.js";

const emitter = new EventEmitter();
const hashName = "Regions";

export const getRegionIdsMap = async() => await hashGetAllCache(hashName);

export async function searchRegionFromMapBySlug(searchSlug) {
    if (typeof searchSlug !== "string") {
        console.warn(searchSlug + "'s not a string!");
        return undefined
    }

    const result = await getRegionIdsMap()
        .filter(([key, value]) => value.slug === searchSlug);

    return result[0] || null;
}

export async function setRegionIdsMap() {
    const newMap = await mapDBRegion()

    if(newMap !== null){
        // regionIdsMap = newMap;
        emitter.emit('update', newMap);
    }

}

export const initialSetRegionIdsMap = async() => await mapDBRegion();
export const onRegionIdsUpdate = () => emitter.on('update', console.info("[Regions Cache] Regions just got cached"));

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
    } catch (error) {
        console.error(error);
    }
}