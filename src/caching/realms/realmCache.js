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
        emitter.emit('update', newMap);
    }

}

export async function initialSetRealmIdsMap() {
    const newMap = await mapDBRealms()

    if(newMap !== null){
        realmIdsMap = newMap;
    }

}

function onRealmIdsUpdate(fn) {
    emitter.on('update', fn);
}

onRealmIdsUpdate(() => console.info("[Realms Cache] Realms just got cached"))

export async function mapDBRealms () {
    try {
        const dbList = await Realm.find().lean();
        const shadowMap = new Map();
        for (const entry of dbList) {

            shadowMap.set(String(entry._id), entry.toObject());

        }

        return shadowMap
    } catch (error) {
        return null
    }
}