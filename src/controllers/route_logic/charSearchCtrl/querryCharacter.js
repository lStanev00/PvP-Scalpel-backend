import { searchCharFromMap } from "../../../caching/searchCache/charSearchCache.js";
import { searchRealmFromMap } from "../../../caching/searchCache/realmSearchCach.js";
import extractRealmsBySearch from "./helpers/extractRealms.js";

export default function queryCharacterBySearch(search) {
    if (typeof search !== "string") {
        console.warn(search + "'s not a string!");
        return undefined
    }

    const realms = extractRealmsBySearch(search);

    return realms

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