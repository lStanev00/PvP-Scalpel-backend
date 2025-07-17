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

export async function insertOneCharSearchMap(newChar) {
    
    if (!newChar._id && !newChar.search) return

    const newCharSearchEntry = newChar;
    const key = extractNameSlug(newCharSearchEntry.search);


    for (let i = 2; i <= key.length; i++){

        const searchVal = key.slice(0, i);
        let searchCharacterEntry = await CharSearchModel.findById(searchVal);
        // const exist = await CharSearchModel.findById(searchVal).populate("relChars").lean();

        if(searchCharacterEntry === null) {

            const newEntry = new CharSearchModel({
                _id: searchVal,
                searchParams: searchVal,
                searchResult: [key],
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
                searchCharacterEntry = await searchCharacterEntry.save();
            }

        }
        searchCharacterEntry = searchCharacterEntry.toObject();
        charSearchMap.set(searchVal, searchCharacterEntry);
        console.info(searchVal)
    }
    console.info(`[Character Search Cache] Character Search ${key}`)



}

export function onCharSearchSetUpdate(fn) {
    emitter.on('update', fn);
}

onCharSearchSetUpdate(() => console.info("[Character Search Cache] Character Search indexes just got cached"));


export async function setDBChars () {
    try {
        const dbCharSearchList = await CharSearchModel.find().lean();
        const shadowMap = new Map();
        for (const entry of dbCharSearchList) {
            shadowMap.set(entry._id, entry);
        }

        return shadowMap
    } catch (error) {

        return null
    }
}