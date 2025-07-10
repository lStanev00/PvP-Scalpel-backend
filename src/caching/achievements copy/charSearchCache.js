import { EventEmitter } from "events";
import Char from "../../Models/Chars.js";

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
        const dbList = await Char.find({}, { search: 1 }).lean();
        const shadowMap = new Map();
        for (const entry of dbList) {

            const key = entry.search;
            const value = entry._id;

            shadowMap.set(key, value);

        }

        return shadowMap
    } catch (error) {

        return null
    }
}