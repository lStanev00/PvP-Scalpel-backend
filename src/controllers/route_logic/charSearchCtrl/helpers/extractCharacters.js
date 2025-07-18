import { findRealmById } from "../../../../caching/realms/realmCache.js";
import { searchRegionFromMapBySlug } from "../../../../caching/regions/regionCache.js";
import { searchCharFromMap } from "../../../../caching/searchCache/charSearchCache.js";
import convertSearch from "../../../../helpers/convertSearch.js";
import { determinateRealmResult } from "./extractRealms.js";


export default function extractCharsBySearch(search, realms) {
    const chars = extractCharacters(search);

    const nameRealmMatch = [];

    for (const {slug, name} of realms) {
        for (const char of chars) {
            if(char?.playerRealm?.slug === slug) nameRealmMatch.push({
                char: char,
                realmName: name
            })
        }
    }

    if (nameRealmMatch.length > 3) return nameRealmMatch.sort((a, b) => 
        a.char.name.length - b.char.name.length
    );

    const longerResult = [...nameRealmMatch];
    if (longerResult.length !== 0) {
        for (const upperChar of nameRealmMatch) {
            for (const char of chars) {
                if(char?.playerRealm?.slug === upperChar?.char?.playerRealm?.slug) continue;
                longerResult.push(formEntry(char))

            }
           
        }
    } else {
        for (const char of chars) {
            longerResult.push(formEntry(char));
        }
    }

    return longerResult.sort((a, b) => 
        a.char.name.length - b.char.name.length
    );

}

function extractCharacters(search) {
    if (typeof search !== "string") {
        console.warn(search + "'s not a string!");
        return undefined
    }

    const [name, realm, server] = convertSearch(search);

    if (!name) return undefined;

    const charSearchMatch = searchCharFromMap(name);
    return charSearchMatch?.relChars

}

function formEntry(char) {
            const regionId = searchRegionFromMapBySlug(char?.server)[0];
            const realmMatch = findRealmById(`${char?.playerRealm?.slug}:${regionId}`);
            const realmResult = determinateRealmResult(realmMatch);
            return {
                char: char,
                realmName: realmResult.name
            }
}

