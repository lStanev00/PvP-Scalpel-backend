import { findRealmById } from "../../../../caching/realms/realmCache.js";
import { searchRegionFromMapBySlug } from "../../../../caching/regions/regionCache.js";
import { searchCharFromMap } from "../../../../caching/searchCache/charSearchCache.js";
import convertSearch from "../../../../helpers/convertSearch.js";
import { determinateRealmResult } from "./extractRealms.js";
import formReadableID from "../../../../helpers/formReadableID.js";


export default async function extractCharsBySearch(search, realms) {
    const chars = await extractCharacters(search);

    const nameRealmMatch = [];

    if(!chars) return nameRealmMatch;

    try {
        for (const {slug, name} of realms) {
            try {
                
                for (const char of chars) {
                    if(char?.playerRealm?.slug === slug) nameRealmMatch.push({
                        char: char,
                        realmName: name
                    })
                }
            } catch (error) {
                return []
            }
        
        }
    } catch (error) {
        if(chars) nameRealmMatch = chars;
        if(!chars)return []
    }


    if (nameRealmMatch.length > 3) return nameRealmMatch.sort((a, b) => 
        a.char.name.length - b.char.name.length
    );

    const longerResult = [...nameRealmMatch];
    if (longerResult.length !== 0) {
        for (const upperChar of nameRealmMatch) {
            for (const char of chars) {
                if(char?.playerRealm?.slug === upperChar?.char?.playerRealm?.slug) continue;
                longerResult.push(await formEntry(char))

            }
           
        }
    } else {
        if(!chars) {
            console.warn(chars);
            return []
        }
        for (const char of chars) {
            longerResult.push(await formEntry(char));
        }
    }

    return longerResult.sort((a, b) => 
        a.char.name.length - b.char.name.length
    );

}

async function extractCharacters(search , exact = undefined) {
    if (typeof search !== "string") {
        console.warn(search + "'s not a string!");
        return undefined
    }

    const [name, realm, server] = convertSearch(search);

    if (!name) return undefined;

    const charSearchMatch = await searchCharFromMap(name);
    if(exact) return charSearchMatch?.relChars;
    if( charSearchMatch && charSearchMatch?.relChars.length > 3) return charSearchMatch?.relChars;

    let inteliChar = name.trim().toLowerCase().split("") || undefined;

    if (!(Array.isArray(inteliChar))) return undefined;
    let match = undefined;
    for(let i = inteliChar.length; i >= 2; i--) {
        inteliChar.pop();
        const checker = await searchCharFromMap(inteliChar.join(""));

        if(checker) {
            match = checker;
            break;
        }
    }

    if(!match && !charSearchMatch) return undefined;
    if (!match) return charSearchMatch?.relChars;
    if (!charSearchMatch) return match?.relChars;
    
    const noDupSet = new Set();

    if(!charSearchMatch.relChars) return match?.relChars;
    if(!match.relChars) return charSearchMatch?.relChars;
    for (const {_id} of charSearchMatch.relChars) {
        const id = formReadableID(_id);
        noDupSet.add(id);
    }

    for (const entry of match.relChars) {
        const id = formReadableID(entry._id)
        if(!(noDupSet.has(id)))charSearchMatch.relChars.push(entry);
    }

    return charSearchMatch?.relChars;

}

async function formEntry(char) {
    const regionId = await searchRegionFromMapBySlug(char?.server);
    const realmMatch = await findRealmById(`${char?.playerRealm?.slug}:${regionId[0] || ""}`);
    const realmResult = await determinateRealmResult(realmMatch);
    return {
        char: char,
        realmName: realmResult.name
    }
}


export async function exactCharMatchBySearch(search) {
    const charsMatch = await extractCharacters(search, true);

    if(!charsMatch) return undefined;
    if(charsMatch.length !== 1) return undefined;

    const char = charsMatch[0];
    const [name, realm, server] = convertSearch(search);
    if(char.search === `${name}:${realm}:${server}`)return await formEntry(charsMatch[0]);

    return undefined
    
}