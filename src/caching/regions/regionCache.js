import { EventEmitter } from "events";
import Region from "../../Models/Regions.js";
import isPlainObject from "../../helpers/objectCheck.js";
import setCache from "../../helpers/redis/setterRedis.js";
import getCache from "../../helpers/redis/getterRedis.js";

const emitter = new EventEmitter();

// let regionIdsMap = new Map();

export async function getRegionIdsMap() {
    // return regionIdsMap
    const data = await getCache("Regions");
    return data;
}

export async function searchRegionFromMapBySlug(searchSlug) {
    if (typeof searchSlug !== "string") {
        console.warn(searchSlug + "'s not a string!");
        return undefined
    }

    // const result = Array.from(regionIdsMap)
    //     .filter(([key, value]) => value.slug === searchSlug);
    // return result[0]

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

export async function initialSetRegionIdsMap() {
    const newMap = await mapDBRegion()

    if(newMap !== null){
        // regionIdsMap = newMap;

    }

}

export function onRegionIdsUpdate(fn) {
    emitter.on('update', fn);
}

onRegionIdsUpdate(() => console.info("[Regions Cache] Regions just got cached"))

export async function mapDBRegion () {
    try {
        const dbList = await Region.find().populate("realms").lean();
        const shadowMap = new Map();
        for (const entry of dbList) {

            const shadowRealmMap = new Map();
            
            if(entry.realms) {
                for (const realm of entry.realms) {
                    if (isPlainObject(realm)) shadowRealmMap.set(realm["_id"], realm);
                }
            }
            entry.realms = shadowRealmMap;
            await setCache(entry._id, entry, "Regions");
            shadowMap.set(String(entry._id), entry);

        }
        return shadowMap
    } catch (error) {
        console.warn(error);
        return null
    }
}