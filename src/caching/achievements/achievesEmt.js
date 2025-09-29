import { EventEmitter } from "events";
import Achievement from "../../Models/Achievements.js";
import { hashGetAllCache } from "../../helpers/redis/getterRedis.js";

const emitter = new EventEmitter();
const hashName = "Achievements";

let seasonalIdsMap = null;

export const getSeasonalIdsMap = async () => await hashGetAllCache(hashName);

export async function setSeasonalIdsMap() {
    const newMap = await mapDBAchieves()

    if(newMap !== null){
        seasonalIdsMap = newMap;
        emitter.emit('update', newMap);
    }

}

export async function initialSetSeasonalIdsMap() {
    const newMap = await mapDBAchieves()

    if(newMap !== null){
        seasonalIdsMap = newMap;
    }

}

export function onSeasonalIdsUpdate(fn) {
    emitter.on('update', fn);
}

onSeasonalIdsUpdate(() => console.info("[Achieves Cache] Achieves just got cached"));


export async function mapDBAchieves () {
    try {
        const dbList = await Achievement.find().lean();
        const shadowMap = new Map();
        for (const entry of dbList) {

            shadowMap.set(String(entry._id), entry);

        }

        return shadowMap
    } catch (error) {

        return null
    }
}