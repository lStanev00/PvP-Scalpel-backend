import { EventEmitter } from "events";
import Char from "../../Models/Chars.js";
import CharSearchModel from "../../Models/SearchCharacter.js";
import extractNameSlug from "../../helpers/extractName.js";
import getCache, { hashGetAllCache } from "../../helpers/redis/getterRedis.js";
import setCache from "../../helpers/redis/setterRedis.js";
import toMap from "../../helpers/toMap.js";
import setDBChars from "./helpers/setDBChars.js";

const hashName = "CharSearch";

const emitter = new EventEmitter();
emitter.on('update', () => console.info("[Character Search Cache] Character Search indexes just got cached"));

export const getCharSearchMap = async() => toMap(await hashGetAllCache(hashName));

export async function initialCharSearchMap() {
    await setDBChars();
    const charList = await Char.find({}, {_id: 1, search: 1}).lean();

    for (const char of charList) {
        const key = extractNameSlug(char.search);
        // const exist = await hasHashCache(hashName, key);
        const exist = await getCache(key, hashName);
        
        if(exist === null) await insertOneCharSearchMap(char);

    }

}

export async function searchCharFromMap(key) {
    if (typeof key !== "string") {
        console.warn(key + "'s not a string!");
        return undefined
    }
    key = key.toLowerCase();
    const result = await getCache(key, hashName);
    return result;
}


export async function insertOneCharSearchMap(newChar) {
    if (!newChar._id && !newChar.search) {
        console.warn(`[SChar Cache] AT => insertOneCharSearchMap\n   => INCORRECT INPUT!\n INPUT TYPE IS => ${typeof newChar}`);
        return
    }

    const newCharSearchEntry = newChar;
    const key = extractNameSlug(newCharSearchEntry.search);
    if (!key) return;

    for (let i = 2; i <= key.length; i++){

        const searchVal = key.slice(0, i);
        await createCharEntry(searchVal, newCharSearchEntry);

    }

    await createCharEntry(newCharSearchEntry?.search, newCharSearchEntry); // Create exact entry match

    console.info(`[Character Search Cache] Just cached character: ${newChar?.search}`)
}

async function createCharEntry (searchVal, newCharSearchEntry) {
        let searchCharacterEntry = await CharSearchModel.findById(searchVal);

        if(searchCharacterEntry === null) {

            const newEntry = new CharSearchModel({
                _id: searchVal.toLowerCase(),
                searchParams: searchVal.toLowerCase(),
                searchResult: [newCharSearchEntry.search],
                relChars: [newCharSearchEntry._id],
            })

            searchCharacterEntry = await newEntry.save();
            searchCharacterEntry = searchCharacterEntry.toObject();
            if(searchCharacterEntry) await setCache(searchCharacterEntry._id, searchCharacterEntry, hashName);
            
        } else {

            let trigger = false;

            if (!searchCharacterEntry.searchResult.includes(newCharSearchEntry.search)) {
                trigger = true;
                searchCharacterEntry.searchResult.push(newCharSearchEntry.search);
            }
            const tryer = [];
            for (const entry of searchCharacterEntry.relChars) {
                tryer.push((entry._id).toString());
            }
            searchCharacterEntry.relChars = [...new Set(tryer)];
            if (!searchCharacterEntry.relChars.includes(newCharSearchEntry._id)) {
                trigger = true;
                searchCharacterEntry.relChars.push(newCharSearchEntry._id);
            }

            if(trigger) {
                searchCharacterEntry = await searchCharacterEntry.save();
                if(searchCharacterEntry) await setCache(searchCharacterEntry._id, searchCharacterEntry, hashName);
            } else {
                console.info(`Prevented`)
            }
        }

}