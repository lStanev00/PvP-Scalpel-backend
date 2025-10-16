import { EventEmitter } from "node:events";
import setCache from "../../helpers/redis/setterRedis.js";
import convertSearch from "../../helpers/convertSearch.js";
import getCache from "../../helpers/redis/getterRedis.js";
import isOlderThanHour from "../../helpers/isOlderThanHour.js";
import Char from "../../Models/Chars.js";
import buildCharSearch from "../../helpers/buildCharSearch.js";
import buildCharacter from "../../helpers/buildCharacter.js";

export const CharCacheEmitter = new EventEmitter();
const hashName = "CharsCache";
const humanReadableName = "Characters Cache";

CharCacheEmitter.on("update", (msg) => console.log(`[${humanReadableName}] ${msg}`));
CharCacheEmitter.on("error", (msg) => console.error(`[${humanReadableName} ERROR] ${msg}`));
CharCacheEmitter.on("info", (msg) => console.info(`[${humanReadableName} INFO] ${msg}`));

export async function cacheOneCharacter(charData) {
    const { _id, search } = charData;
    if (!_id || !search) {
        CharCacheEmitter.emit(
            "error",
            `${arguments.callee.name} has been invoked with bad params\n the function will now exit.`
        );
        return null;
    }

    await setCache(search, charData, hashName);
}



export async function getCharacter(server, realm, name, update = true, search = "") {
    
    let character;
    
    if (search === "" || typeof search !== "string") {
        search = buildCharSearch(server, realm, name);
    }
    try {
        character = await getCharFromCacheBySearch(search);

        if(character.code === 404 && character.lastUpdated) {
            if(!(isOlderThanHour(character.lastUpdated))) return 404;
        }

        if (character && character !== undefined && character !== null && !(character.code)) {
            // ++++++++++++++++++++++++++++ ?3 
            if (update) {
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

    const checkedCountClone = character 
        ? character.checkedCount
        : undefined

    try {

        let checkedCountIncrementation = 0;

        if (update) {
            if (checkedCountClone && typeof checkedCountClone === "number") {
                const data = await Char.findOne(
                    {
                        name: new RegExp(`^${name}$`, 'i'),
                        "playerRealm.slug": realm,
                        server: server
                    }
                ).lean();
                if(data) {
                    checkedCountIncrementation = checkedCountClone - data.checkedCount;
                } 
            }
        }

        checkedCountIncrementation = checkedCountIncrementation + 1;

        character = await Char.findOneAndUpdate(
            {
                name: new RegExp(`^${name}$`, 'i'),
                "playerRealm.slug": realm,
                server: server
            },
            { $inc: { checkedCount: checkedCountIncrementation } }, 
            { new: true, upsert: false, timestamps: false }
        )
        if (!character) {
            character = await buildCharacter(server, realm, name);
            if(character === null ) {
                await setCache(search, {
                   code: 404,
                   lastUpdated : Date.now() 
                }, hashName )
                return 404;
            }
            jsonResponse(res, 200, character);
            return res.end()
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
    return character
}

async function getCharFromCacheBySearch(search) {
    const CSParts = convertSearch(search);
    if (!CSParts) {
        if (!search) {
            CharCacheEmitter.emit(
                "error",
                `${arguments.callee.name} has been invoked with bad params\n the function will now exit.`
            );
            return null;
        }
    };

    search = CSParts.join("");

    const result = await getCache(search, hashName);

    return isOlderThanHour(result) ? undefined : result;

}