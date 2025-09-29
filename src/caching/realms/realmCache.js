import { EventEmitter } from "events";
import Realm from "../../Models/Realms.js";
import getCache from "../../helpers/redis/getterRedis.js";
import setCache from "../../helpers/redis/setterRedis.js";

const emitter = new EventEmitter();
// let realmIdsMap = new Map();

export async function getRealmIdsMap() {
    // return realmIdsMap
    return await getCache("Realms");
}

export async function findRealmById(id) {
    if(!id) return

    // return realmIdsMap.get(id);
    return await getCache(id, "Realms");
    
}

export async function setRealmIdsMap() {
    const newMap = await mapDBRealms()

    if(newMap !== null){
        // realmIdsMap = newMap;
        emitter.emit('update', newMap);
    }

}

export async function initialSetRealmIdsMap() {
    const newMap = await mapDBRealms()

    if(newMap !== null){
        // realmIdsMap = newMap;
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

            const key = entry.slug + ":" + entry.region;
            
            const value = entry;

            shadowMap.set(String(key), value);
            await setCache(key, value, "Realms");

        }

        return shadowMap
    } catch (error) {
        return null
    }
}