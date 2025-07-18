import { EventEmitter } from "events";
import RealmSearchModel from "../../Models/SearchRealm.js";
import slugify from "../../helpers/slugify.js";

const emitter = new EventEmitter();

let realmSearchMap = new Map();

export function getRealmSearchMap() {
    return realmSearchMap
}

export function searchRealmFromMap(key) {
    if (typeof key !== "string") {
        console.warn(key + "'s not a string!");
        return undefined
    }

    const result = realmSearchMap.get(key);

    return result
}

export async function setRealmSearchMap() {
    const newMap = await setDBRealmSearch();

    if(newMap !== null){
        realmSearchMap = newMap;
        emitter.emit('update', newMap);
    }

}

export async function initialRealmSearchMap() {
    const newMap = await setDBRealmSearch();

    if(newMap !== null){
        realmSearchMap = newMap;
    }

}

export async function insertOneRealmSearchMap(newRealm) {

    if(!newRealm.slug) return;
    const newRealmSlug = newRealm.slug;
    const zone = newRealm?.["locale"]
    const slug2 = slugify(newRealm?.name?.[zone]) || undefined;
    const _id = newRealm?._id

    await updateNewRealmDbaseAndLocal(newRealmSlug, _id).catch(err => {console.warn(err)});
    if(newRealmSlug !== slug2 && slug2 !== undefined) await updateNewRealmDbaseAndLocal(slug2, _id).catch(err => {console.warn(err)});


}

export function onRealmSearchSetUpdate(fn) {
    emitter.on('update', fn);
}

onRealmSearchSetUpdate(() => console.info("[Realm Search Cache] Realm Search indexes just got cached"));


export async function setDBRealmSearch () {
    try {
        const dbList = await RealmSearchModel.find().populate("relRealms").lean();
        const shadowMap = new Map();
        for (const entry of dbList) {
            shadowMap.set(entry._id, entry);
        }

        return shadowMap
    } catch (error) {

        return null
    }
}

async function updateNewRealmDbaseAndLocal(newRealmSlug, realm_id = undefined) {

    try {
            if(typeof newRealmSlug !== "string") throw new TypeError(`The value provided is not a string`);
            if(!realm_id) return
    
            for (let i = 2; i <= newRealmSlug.length; i++) {
                const searchVal = newRealmSlug.slice(0, i);
                
                let entry = await RealmSearchModel.findById(searchVal);
                if(entry === null) {

                    const newEntry = new RealmSearchModel({
                        _id: searchVal,
                        searchParams: searchVal,
                        searchResult: [newRealmSlug],
                        relRealms: [realm_id],
                    })
            
                    entry = (await newEntry.save()).toObject();

                } else {

                    let trigger = false; // mutable!
                    if (!entry.searchResult.includes(newRealmSlug)) {
                        trigger = true;
                        entry.searchResult.push(newRealmSlug);
                    }
                    if (!entry.relRealms.includes(realm_id)) {
                        trigger = true;
                        entry.relRealms.push(realm_id);
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