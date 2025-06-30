import { EventEmitter } from "events";
import Achievement from "../../Models/Achievements";

const emitter = new EventEmitter();

let seasonalIdsMap = null;

export function getSeasonalIds() {
    return seasonalIdsMap
}

export async function setSeasonalIds() {
    const newMap = await mapDBAchieves()

    if(newMap !== null){
        seasonalIdsMap = newMap;
        emitter.emit('update', newMap);
    }

}

export function onSeasonalIdsUpdate(fn) {
    emitter.on('update', fn);
}


export async function mapDBAchieves () {
    try {
        const dbList = await Achievement.find();
        const shadowMap = new Map();
        for (const entry of dbList) {

            shadowMap.set(String(entry._id), entry.toObject());

        }

        return shadowMap
    } catch (error) {
        return null
    }
}