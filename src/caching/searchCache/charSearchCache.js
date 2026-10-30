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
    wipeCharSearchEntry(search, newSearch).catch((error) => {
        CharSearchCacheEmiter.emit(
            "error",
            `Purge failed\nsearch: ${search}\nnewSearch: ${newSearch}\n${error?.stack ?? error}`,
        );
    });
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
        CharSearchCacheEmiter.emit("error", key + "'s not a string!");
        return undefined
    }
    key = key.toLowerCase();
    const result = await getCache(key, hashName);
    return result;
}


export async function insertOneCharSearchMap(newChar) {
    if (!newChar._id && !newChar.search) {
        CharSearchCacheEmiter.emit("error", `AT => insertOneCharSearchMap\n   => INCORRECT INPUT!\n INPUT TYPE IS => ${typeof newChar}`);
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

    CharSearchCacheEmiter.emit("info", `Just cached character: ${newChar?.search}`);
}

/**
 * Creates or updates one character-search entry and caches saved entries in Redis.
 * Reloads the existing entry if a concurrent insert causes a duplicate-key error.
 *
 * @param {string} searchVal Character-name prefix or full `name:realm:server` key.
 * @param {object} newCharSearchEntry Character to associate with the search entry.
 * @param {import("mongoose").Types.ObjectId|string} newCharSearchEntry._id Character document ID.
 * @param {string} newCharSearchEntry.search Canonical `name:realm:server` key.
 * @returns {Promise<void>} Resolves after entry processing and any cache write.
 */
async function createCharEntry (searchVal, newCharSearchEntry) {
        let searchCharacterEntry = await CharSearchModel.findById(searchVal);

        if(searchCharacterEntry === null) {

            const newEntry = new CharSearchModel({
                _id: searchVal.toLowerCase(),
                searchParams: searchVal.toLowerCase(),
                searchResult: [newCharSearchEntry.search],
                relChars: [newCharSearchEntry._id],
            });
            try {
                searchCharacterEntry = await newEntry.save();
            } catch (error) {
                if (error?.code === 11000) {
                    const stringID =
                        typeof newCharSearchEntry._id === "string"
                            ? newCharSearchEntry._id
                            : newCharSearchEntry._id.toString();
                    searchCharacterEntry = await CharSearchModel.findById(searchVal);

                    if (searchCharacterEntry) {
                        const exists = searchCharacterEntry.relChars.some(
                            (ref) => String(ref._id ?? ref) === stringID,
                        );

                        if (!exists) {
                            searchCharacterEntry.relChars.push(stringID)
                        }

                        if (
                            !searchCharacterEntry.searchResult.includes(newCharSearchEntry.search)
                        ) {
                            searchCharacterEntry.searchResult.push(newCharSearchEntry.search);
                        }

                        await searchCharacterEntry.save()
                    } else {
                        CharSearchCacheEmiter.emit(
                            "error",
                            `Entry "${searchVal}" missing after duplicate-key error for ${newCharSearchEntry.search}.\n${error?.stack ?? error}`,
                        );
                        return;
                    }
                } else {throw error}
            }
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
                CharSearchCacheEmiter.emit("info", "Prevented");
            }
        }

}

async function wipeCharSearchEntry(search, newSearch) {
/**
 * Wipes a character search entry completely from both MongoDB and Redis and cache the new one.
 * 
 * @param {String} searchVal - The search term to remove (e.g., "dwarfrogue" or "dw").
 * @param {String} newSearch - The new search term that has been created (e.g., "dwarfrogue" or "dw").
 * @returns {Promise<Number>} 
 */

    if (typeof search !== "string" || search.trim().length === 0) {
        CharSearchCacheEmiter.emit("error", `[CharSearch Wipe] Invalid input: ${search}`);
        return ;
    }
    const CSParts = convertSearch(search);
    if(CSParts !== undefined && CSParts.length  === 3) {
        search = buildCharSearch({
            server: CSParts[2],
            realm: CSParts[1],
            name: CSParts[0],
        })
    }
    const mongoData = await CharSearchModel.find({searchResult : search})

    const char = await Char.findOne({search : newSearch});
    if (!char) {
        CharSearchCacheEmiter.emit("error", `[CharSearch Wipe] Character not found for ${newSearch}; skipping purge of ${search}.`);
        return;
    }

    const id = String(char._id ?? char.id);
    const updates = [];
    for (const entry of mongoData) {
        const searchResultIndex = entry.searchResult.indexOf(search);
        if (searchResultIndex !== -1) entry.searchResult.splice(searchResultIndex, 1);
        const relCharsIndex = entry.relChars.findIndex((ref) =>
            ref != null && String(ref._id ?? ref) === id,
        );
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

    await insertOneCharSearchMap(char);
    
}
