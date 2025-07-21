import { EventEmitter } from "events";
import Char from "../../Models/Chars.js";
import CharSearchModel from "../../Models/SearchCharacter.js";
import extractNameSlug from "../../helpers/extractName.js";

const emitter = new EventEmitter();

let charSearchMap = new Map();

export function getCharSearchMap() {
    return charSearchMap
}

export async function initialCharSearchMap() {
    const newMap = await setDBChars();
    const charList = await Char.find({}, {_id: 1, search: 1}).lean();
    if(newMap !== null){
        charSearchMap = newMap;
    }

    for (const char of charList) {
        const key = extractNameSlug(char.search);
        const exist = charSearchMap.has(key);
        
        if(!exist) await insertOneCharSearchMap(char);

    }


}

export function searchCharFromMap(key) {
    if (typeof key !== "string") {
        console.warn(key + "'s not a string!");
        return undefined
    }
    key = KeyObject.toLowerCase();
    const result = charSearchMap.get(key);

    return result
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

    console.info(`[Character Search Cache] Just cached character: ${key}`)



}

export function onCharSearchSetUpdate(fn) {
    emitter.on('update', fn);
}

onCharSearchSetUpdate(() => console.info("[Character Search Cache] Character Search indexes just got cached"));


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
        // const exist = await CharSearchModel.findById(searchVal).populate("relChars").lean();
        if(searchCharacterEntry === null) {

            const newEntry = new CharSearchModel({
                _id: searchVal.toLowerCase(),
                searchParams: searchVal.toLowerCase(),
                searchResult: [newCharSearchEntry.search],
                relChars: [newCharSearchEntry._id],
            })

            searchCharacterEntry = await newEntry.save()
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