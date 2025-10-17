import { EventEmitter } from "events";
import Char from "../../Models/Chars.js";
import CharSearchModel from "../../Models/SearchCharacter.js";
import extractNameSlug from "../../helpers/extractName.js";
import getCache, { hashGetAllCache } from "../../helpers/redis/getterRedis.js";
import setCache from "../../helpers/redis/setterRedis.js";
import toMap from "../../helpers/toMap.js";
import setDBChars from "./helpers/setDBChars.js";
import convertSearch from "../../helpers/convertSearch.js";
import buildCharSearch from "../../helpers/buildCharSearch.js";

const hashName = "CharSearch";

export const CharSearchCacheEmiter = new EventEmitter();
CharSearchCacheEmiter.on('update', () => console.info("[Character Search Cache] Character Search indexes just got cached"));
CharSearchCacheEmiter.on("error", (msg) => console.error(`[Character Search Cache ERROR] ${msg}`));
CharSearchCacheEmiter.on("info", (msg) => console.info(`[Character Search Cache INFO] ${msg}`));
CharSearchCacheEmiter.on('purge', (search, newSearch) => {
    wipeCharSearchEntry(search, newSearch)
});

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

async function wipeCharSearchEntry(search, newSearch) {
/**
 * Wipes a character search entry completely from both MongoDB and Redis.
 * 
 * @param {String} searchVal - The search term to remove (e.g., "dwarfrogue" or "dw").
 * @returns {Promise<Number>} 
 */

    if (typeof search !== "string" || search.trim().length === 0) {
        console.warn("[CharSearch Wipe] Invalid input:", search);
        return ;
    }
    const CSParts = convertSearch(search);
    if(CSParts.length  === 3 && CSParts !== undefined) {
        search = buildCharSearch(...CSParts)
    }
    const mongoData = await CharSearchModel.find({searchResult : search})

    if (mongoData.length === 0) {
        CharSearchCacheEmiter.emit("error", `There seems to me no data for ${search} to be purged ---\n The fn will now exit.`);
        return;
    }

    const char = await Char.findOne({search : newSearch});

    const id = char.id; 
    const updates = [];
    for (const entry of mongoData) {
        const searchResultIndex = entry.searchResult.indexOf(search);
        if (searchResultIndex !== -1) entry.searchResult.splice(searchResultIndex, 1);
        const relCharsIndex = entry.relChars.indexOf(id);
        if (relCharsIndex !== -1) entry.relChars.splice(relCharsIndex, 1);
        await entry.save();

        updates.push(entry.id);

    }

    for (const id of updates) {
        const data = await CharSearchModel.findById(id).populate({
                path: "relChars",
                select: "_id name playerRealm server class search",
            })

        if(data) await setCache(data._id, data.toObject(), hashName);

    }

    if (char) insertOneCharSearchMap(char)
    
}