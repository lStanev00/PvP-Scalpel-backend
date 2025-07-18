import { searchRegionFromMapBySlug } from "../../../caching/regions/regionCache.js";
import { searchCharFromMap } from "../../../caching/searchCache/charSearchCache.js";
import { searchRealmFromMap } from "../../../caching/searchCache/realmSearchCach.js";
import convertSearch from "../../../helpers/convertSearch.js";

export default async function queryCharacterBySearch(search) {
    if (typeof search !== "string") {
        console.warn(search + "'s not a string!");
        return undefined
    }
    let [name, realm, server] = convertSearch(search);

    const result = {
        exactMatch: undefined,
        names: undefined,
        realms: undefined,
        server: server,
        search: search,
    }

    const exactMatch = searchCharFromMap(`${name}:${realm}:${server}`);
    if(exactMatch) result.exactMatch = exactMatch;
    
    const searchCharsMapEntry = searchCharFromMap(name);
    if (searchCharsMapEntry) result.names = searchCharsMapEntry;

    if (realm !== "!undefined!") {
        const searchRealmMapEntry = searchRealmFromMap(realm);
        if(searchRealmMapEntry) result.realms = searchCharsMapEntry;
    }



}

export function buildRealmNameByCharSrch (charMatchArr) {
    if (!(Array.isArray(charMatchArr))) {
        console.warn(charMatchArr + "'s not an Array type!");
        return undefined
    }

    const result = {

    }

    for (const search of charMatchArr) {

        if(typeof search !== "string") continue;

        const [name, realm, server] = convertSearch(search);

        const serverMatch = searchRegionFromMapBySlug(server);

        console.log(serverMatch);

    }
    

}