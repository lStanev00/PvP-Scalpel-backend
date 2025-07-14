import { EventEmitter } from "events";
import Char from "../../Models/Chars.js";
import CharSearchModel from "../../Models/SearchCharacter.js";

const emitter = new EventEmitter();

let charSearchMap = new Map();

export function getCharSearchMap() {
    return charSearchMap
}

export async function setCharSearchMap() {
    const newMap = await setDBChars();

    if(newMap !== null){
        charSearchMap = newMap;
        emitter.emit('update', newMap);
    }

}

export async function initialCharSearchMap() {
    const newMap = await setDBChars();

    if(newMap !== null){
        charSearchMap = newMap;
    }

}

export function insertOneCharSearchMap(newChar) {
    
    if (!(newChar instanceof Char)) return

    charSearchMap.set(newChar.search, newChar._id);

    console.info(`[Character Search Cache] Character: ${newChar.name}-${newChar.playerRealm.name}, just got cached.`)

}

export function onCharSearchSetUpdate(fn) {
    emitter.on('update', fn);
}

onCharSearchSetUpdate(() => console.info("[Character Search Cache] Character Search indexes just got cached"));


export async function setDBChars () {
    try {
        const dbList = await Char.find({}, { search: 1, _id: 1, name: 1, server: 1, playerRealm: 1 }).lean();
        const shadowMap = new Map();
        for (const entry of dbList) {

            const key = entry.search;
            const value = {
                _id: entry._id,
                name : entry.name,
                server: entry.server,
                playerRealm: entry.playerRealm
            };

            shadowMap.set(key, value);

            for (let i = 3; i <= key.length; i++){
                const searchVal = key.slice(0, i);
                const exist = await CharSearchModel.findById(searchVal);
                // const exist = await CharSearchModel.findById(searchVal).populate("relChars").lean();

                if(exist === null) {
                    const newEntry = new CharSearchModel({
                        _id: searchVal,
                        searchParams: searchVal,
                        searchResult: [key],
                        relChars: [entry._id],
                        data: value
                    })
                    await newEntry.save();
                } else {
                    let trigger = false;
                    if (!exist.searchResult.includes(entry.search)) {
                        trigger = true;
                        exist.searchResult.push(entry.search);
                    }
                    if (!exist.relChars.includes(entry._id)) {
                        trigger = true;
                        exist.relChars.push(entry._id);
                    }
                    if(trigger) {

                        await exist.save();

                    }
                }
                // console.info(exist)
            }

        }

        return shadowMap
    } catch (error) {

        return null
    }
}