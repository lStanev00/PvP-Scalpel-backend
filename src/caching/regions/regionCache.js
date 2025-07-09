import { EventEmitter } from "events";
import Region from "../../Models/Regions.js";

const emitter = new EventEmitter();

let regionIdsMap = null;

export function getRegionIdsMap() {
    return regionIdsMap
}

export async function setRegionIdsMap() {
    const newMap = await mapDBRegion()

    if(newMap !== null){
        regionIdsMap = newMap;
        emitter.emit('update', newMap);
    }

}

export async function initialSetRegionIdsMap() {
    const newMap = await mapDBRegion()

    if(newMap !== null){
        regionIdsMap = newMap;
    }

}

export function onRegionIdsUpdate(fn) {
    emitter.on('update', fn);
}

onRegionIdsUpdate(() => console.info("[Regions Cache] Regions just got cached"))

export async function mapDBRegion () {
    try {
        const dbList = await Region.find();
        const shadowMap = new Map();
        for (const entry of dbList) {

            shadowMap.set(String(entry._id), (entry.name).toLowerCase());

        }

        return shadowMap
    } catch (error) {
        return null
    }
}