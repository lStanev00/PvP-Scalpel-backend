import { EventEmitter } from "events";
import Realm from "../../Models/Realms.js";
import RealmSearchModel from "../../Models/SearchRealm.js";

const emitter = new EventEmitter();

let realmSearchMap = new Map();

export function getRealmSearchMap() {
    return realmSearchMap
}

export async function setRealmSearchMap() {
    const newMap = await setDBChars();

    if(newMap !== null){
        realmSearchMap = newMap;
        emitter.emit('update', newMap);
    }

}

export async function initialRealmSearchMap() {
    const newMap = await setDBChars();

    if(newMap !== null){
        realmSearchMap = newMap;
    }

}

export async function insertOneRealmSearchMap(newRealm) {

    if(!newRealm.slug) return;

    try {
        const newRealmSlug = newRealm.slug;
    
        for (let i = 2; i <= newRealmSlug.length; i++) {
            const searchVal = newRealmSlug.slice(0, i);
            
            let entry = await RealmSearchModel.findById(searchVal);
            if(entry === null) {

                const newEntry = new RealmSearchModel({
                    _id: searchVal,
                    searchParams: searchVal,
                    searchResult: [newRealmSlug],
                    relRealms: [newRealm._id],
                })
        
                entry = (await newEntry.save()).toObject();

            } else {

                let trigger = false; // mutable!
                if (!entry.searchResult.includes(newRealm.slug)) {
                    trigger = true;
                    entry.searchResult.push(newRealm.slug);
                }
                if (!entry.relRealms.includes(newRealm._id)) {
                    trigger = true;
                    entry.relRealms.push(newRealm._id);
                }
                if(trigger) {

                    await entry.save();

                }

            }
            realmSearchMap.set(searchVal, entry)

        }

        console.info(`[Realm Search Cache] Realm: ${newRealmSlug}, just got cached.`)
        
    } catch (error) {
        console.warn(error)
    }



}

export function onRealmSearchSetUpdate(fn) {
    emitter.on('update', fn);
}

onRealmSearchSetUpdate(() => console.info("[Realm Search Cache] Realm Search indexes just got cached"));


export async function setDBChars () {
    try {
        const dbList = await RealmSearchModel.find().lean();
        const shadowMap = new Map();
        for (const entry of dbList) {
            shadowMap.set(entry._id, entry);
        }

        return shadowMap
    } catch (error) {

        return null
    }
}