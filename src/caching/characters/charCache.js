import { EventEmitter } from "node:events";
import setCache from "../../helpers/redis/setterRedis.js";
import convertSearch from "../../helpers/convertSearch.js";
import getCache from "../../helpers/redis/getterRedis.js";
import isOlderThanHour from "../../helpers/isOlderThanHour.js";
import Char from "../../Models/Chars.js";
import buildCharSearch from "../../helpers/buildCharSearch.js";
import buildCharacter from "../../helpers/buildCharacter.js";
import fetchData from "../../helpers/blizFetch.js";

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



export async function getCharacter(server, realm, name, update = true) {
    
    let character;
    const search = buildCharSearch(server, realm, name); 

    try {
        character = await getCharFromCacheBySearch(search);

        if(character?.code === 404 && character?.updatedAt) {
            if(!(isOlderThanHour(character))) return 404;
        }

        if (character && character !== undefined && character !== null && !(character?.code)) {
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
        character = await Char.findOne(
            {
                name: new RegExp(`^${name}$`, 'i'),
                "playerRealm.slug": realm,
                server: server
            }
        ).lean();

        if (update && character?.checkedCount) {
            if (checkedCountClone && typeof checkedCountClone === "number") {
                checkedCountIncrementation = checkedCountClone - data.checkedCount;
            } else {
                checkedCountIncrementation = character.checkedCount
            }
            checkedCountIncrementation = checkedCountIncrementation + 1;
            character.checkedCount = checkedCountIncrementation;
        }


        if (character && isOlderThanHour(character)) {
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
                `${arguments.callee.name} has been invoked with bad params\n the function will now exit.`
            );
            return null;
        }
    };

    search = CSParts.join(":");

    const result = await getCache(search, hashName);
    if(result === null || !result) return null;
    return isOlderThanHour(result) ? undefined : result;

}