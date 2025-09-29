import { EventEmitter } from "events";
import Char from "../../Models/Chars.js";
import CharSearchModel from "../../Models/SearchCharacter.js";
import extractNameSlug from "../../helpers/extractName.js";
import getCache, { hashGetAllCache } from "../../helpers/redis/getterRedis.js";
import hasHashCache from "../../helpers/redis/checkersRedis.js";

const hashName = "CharSearch";

const emitter = new EventEmitter();
emitter.on('update', console.info("[Character Search Cache] Character Search indexes just got cached"));

export const getCharSearchMap = async() => await hashGetAllCache(hashName);

export async function initialCharSearchMap() {
    await setDBChars();
    const charList = await Char.find({}, {_id: 1, search: 1}).lean();

    for (const char of charList) {
        const key = extractNameSlug(char.search);
        const exist = await hasHashCache(hashName, key);
        
        if(!exist) await insertOneCharSearchMap(char);

    }

}

export async function searchCharFromMap(key) {
    if (typeof key !== "string") {
        console.warn(key + "'s not a string!");
        return undefined
    }
    key = key.toLowerCase();

    return await getCache(key, hashName);
}


export async function insertOneCharSearchMap(newChar) {
    if (!newChar._id && !newChar.search) return

    const newCharSearchEntry = newChar;
    const key = extractNameSlug(newCharSearchEntry.search);
    if (!key) return;

    for (let i = 2; i <= key.length; i++){

        const searchVal = key.slice(0, i);
        await createCharEntry(searchVal, newCharSearchEntry);

    }

    await createCharEntry(newCharSearchEntry?.search, newCharSearchEntry);
    await initialCharSearchMap();

    console.info(`[Character Search Cache] Just cached character: ${key}`)
}

export async function setDBChars () {
    try {
        const dbCharSearchList = await CharSearchModel.find().populate({
            path: "relChars",
            select: "_id name playerRealm server class search"
        }).lean();
        const shadowMap = new Map();
        for (const entry of dbCharSearchList) {
            const leanEntry = entry;
            shadowMap.set(leanEntry._id, leanEntry);
        }

        return shadowMap
    } catch (error) {

        return null
    }
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
        } else {

            let trigger = false;

            if (!searchCharacterEntry.searchResult.includes(newCharSearchEntry.search)) {
                trigger = true;
                searchCharacterEntry.searchResult.push(newCharSearchEntry.search);
            }

            if (!searchCharacterEntry.relChars.includes(newCharSearchEntry._id)) {
                trigger = true;
                searchCharacterEntry.relChars.push(newCharSearchEntry._id);
            }

            if(trigger) {
                await searchCharacterEntry.save();
            }
        }

}