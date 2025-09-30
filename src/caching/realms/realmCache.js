import { EventEmitter } from "events";
import Realm from "../../Models/Realms.js";
import getCache, { hashGetAllCache } from "../../helpers/redis/getterRedis.js";
import setCache from "../../helpers/redis/setterRedis.js";

const hashName = "Realms";

const emitter = new EventEmitter();
emitter.on('update', () => console.info("[Realms Cache] Realms just got cached"));

export const getRealmIdsMap= async() => await hashGetAllCache(hashName);
export const findRealmById = async (id) => await getCache(id, hashName);
export const initialSetRealmIdsMap = async() => await mapDBRealms();

export async function setRealmIdsMap() {
    const newMap = await mapDBRealms()

    if(newMap !== null){
        emitter.emit('update', newMap);
    }

}

export async function mapDBRealms () {
    try {
        const dbList = await Realm.find().lean();
        for (const entry of dbList) {

            const key = entry.slug + ":" + entry.region;
            
            const value = entry;

            await setCache(key, value, hashName);

        }

    } catch (error) {
        console.error(error)
    }
}