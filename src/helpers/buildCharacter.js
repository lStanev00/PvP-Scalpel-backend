import { cacheOneCharacter } from "../caching/characters/charCache.js";
import { insertOneCharSearchMap } from "../caching/searchCache/charSearchCache.js";
import Char from "../Models/Chars.js";
import fetchData from "./blizFetch.js";
import delCache from "./redis/deletersRedis.js";
import getCache from "./redis/getterRedis.js";
import setCache from "./redis/setterRedis.js";
import { delay } from "./startBGTask.js";

// If no mongo entry try updating the db with a new one and send it
export default async function buildCharacter(server, realm, name, character) {
    const hashName = "buildingEntries";

    const key = `${server + realm + name}`;
    const doesEntryAlreadyBuild = await getCache(key, hashName);
    if (doesEntryAlreadyBuild && doesEntryAlreadyBuild !== null) {

        while (true) {

            await delay(300);
            const exist = await getCache(key, hashName);
            if(!exist || exist === null) break;
            
        };
        character = await Char.findOne({
                name: new RegExp(`^${name}$`, 'i'),
                "playerRealm.slug": realm,
                server: server
        }).populate({
            path: "posts", 
            populate: {
              path: "author",          
              select: "username _id"   
            }
          }).lean();
        return character
    }

    await setCache(key, "true", hashName);

    character = await fetchData(server, realm, name);
    if (character == false) {
        console.log("Character missing: ",server,realm,name);
        await delCache(key, hashName);
        return null
    }
    character.checkedCount = 0;
    try {
        const newCharacter = new Char(character);
        const savedChar = await newCharacter.save();
        
        await delCache(key, hashName);

        insertOneCharSearchMap(savedChar);
        // cacheOneCharacter(savedChar.toObject());
        return savedChar;
        
    } catch (error) {
        console.log(error)
        return null;
    }
}