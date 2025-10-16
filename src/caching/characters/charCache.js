import { EventEmitter } from "node:events";
import setCache from "../../helpers/redis/setterRedis.js";
import convertSearch from "../../helpers/convertSearch.js";
import getCache from "../../helpers/redis/getterRedis.js";
import isOlderThanHour from "../../helpers/isOlderThanHour.js";
import Char from "../../Models/Chars.js";
import buildCharSearch from "../../helpers/buildCharSearch.js";
import buildCharacter from "../../helpers/buildCharacter.js";
import fetchData from "../../helpers/blizFetch.js";
import queryCharacterByCredentials from "./utils/queryCharByCredentials.js";
import shipCharById from "./utils/shipCharById.js";

export const CharCacheEmitter = new EventEmitter();
const hashName = "CharsCache";
const humanReadableName = "Characters Cache";

CharCacheEmitter.on("update", (msg) => console.log(`[${humanReadableName}] ${msg}`));
CharCacheEmitter.on("error", (msg) => console.error(`[${humanReadableName} ERROR] ${msg}`));
CharCacheEmitter.on("info", (msg) => console.info(`[${humanReadableName} INFO] ${msg}`));
CharCacheEmitter.on("updateRequest", (charData, charID) => {
    cacheOneCharacter(charData, charID);
});


export async function cacheOneCharacter(charData, charID = undefined) {
    let search = charData?.search
    const _id = charData?._id
    if ((!_id || !search) && charID === undefined) {
        CharCacheEmitter.emit("error", `cacheOneCharacter invoked with bad params`);
        return null;
    }

    if ((!charData || charData === null) && charID !== undefined) charData = await shipCharById(charID);
    search = charData?.search;
    if (charData && search) await setCache(search, charData, hashName);
}



export async function getCharacter(server, realm, name, incChecks = true, renewCache = false) {
     
    let character;
    const search = buildCharSearch(server, realm, name); 

    try { // redis data logic
        if (renewCache === false) character = await getCharFromCacheBySearch(search);
            else if (renewCache === true) character = undefined;

        if(character?.code === 404 && character?.updatedAt) {
            if(!(isOlderThanHour(character))) return 404;
        }

        if (character && character !== undefined && character !== null && !(character?.code)) {
            if (incChecks) {
                character.checkedCount = character.checkedCount + 1;
            }            
            await setCache(search, character, hashName);
            return character;
        } else {
            character = undefined;
        };
    } catch (error) {
        console.warn(error);
        character = undefined;
    }

    // Query database or renew older data |
    //                                    V
    const checkedCountClone = character 
        ? character.checkedCount
        : undefined

    try {

        let checkedCountIncrementation = 0;
        character = await queryCharacterByCredentials(server, realm, name);

        if (incChecks && character?.checkedCount) {
            if (checkedCountClone && typeof checkedCountClone === "number") {
                checkedCountIncrementation = checkedCountClone - data.checkedCount;
            } else {
                checkedCountIncrementation = character.checkedCount
            }
            checkedCountIncrementation = checkedCountIncrementation + 1;
            character.checkedCount = checkedCountIncrementation;
        }


        if (character && (isOlderThanHour(character) || renewCache === true)) {
            const newData = await fetchData(character.server, character.playerRealm.slug, character.name, character.checkedCount);
            if(newData) {
                for (const [key, value] of Object.entries(newData)) {
                    if(character?.[key] && value) character[key] = value;
                }
                
                character = await Char.findByIdAndUpdate(character._id, { $set: character }, {new: true});
            }
        } else if (character) {
            character = await Char.findOneAndUpdate(
                {
                    name: new RegExp(`^${name}$`, 'i'),
                    "playerRealm.slug": realm,
                    server: server
                },
                { $set: { checkedCount: checkedCountIncrementation } }, 
                { new: true, upsert: false, timestamps: false }
            )

        }

        if (!character) {
            character = await buildCharacter(server, realm, name);
            if(character === null ) {
                await setCache(search, {
                   code: 404,
                   updatedAt : Date.now() 
                }, hashName )
                return 404;
            }
        }
        try {
            await character.populate({
                path: "posts", 
                populate: {
                    path: "author",          
                    select: "username _id"   
                }
            })
            
        } catch (error) {
            // posts can be missing
        }
        await character.populate("listAchievements");
        character = character.toObject();
        await cacheOneCharacter(character);
        
        
    } catch (error) {
        console.warn(error)
    }
}

async function getCharFromCacheBySearch(search) {
    const CSParts = convertSearch(search);
    if (!CSParts) {
        if (!search) {
            CharCacheEmitter.emit(
                "error",
                `getCharFromCacheBySearch has been invoked with bad params\n the function will now exit.`
            );
            return null;
        }
    };

    search = CSParts.join(":");

    const result = await getCache(search, hashName);
    if(result === null || !result) return null;
    return isOlderThanHour(result) ? undefined : result;

}