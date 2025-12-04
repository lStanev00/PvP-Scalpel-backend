import { EventEmitter } from "events";
import Achievement from "../../Models/Achievements.js";
import getCache, { hashGetAllCache } from "../../helpers/redis/getterRedis.js";
import setCache from "../../helpers/redis/setterRedis.js";
import toMap from "../../helpers/toMap.js";

const emitter = new EventEmitter();
emitter.on('update', () => console.info("[Achieves Cache] Achieves just got cached"));
const hashName = "Achievements";

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