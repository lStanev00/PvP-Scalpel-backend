import { EventEmitter } from "events";
import Realm from "../../Models/Realms.js";

const emitter = new EventEmitter();

let realmIdsMap = null;

export function getRealmIdsMap() {
    return realmIdsMap
}

export async function setRealmIdsMap() {
    const newMap = await mapDBRealms()

    if(newMap !== null){
        realmIdsMap = newMap;
        console.info("[Achieves Cache] Realms just got cached")
        emitter.emit('update', newMap);
    }

}

export function onRealmIdsUpdate(fn) {
    emitter.on('update', fn);
}


export async function mapDBRealms () {
    try {
        const dbList = await Realm.find();
        const shadowMap = new Map();
        for (const entry of dbList) {

            shadowMap.set(String(entry._id), entry.toObject());

        }

        return shadowMap
    } catch (error) {
        return null
    }
}