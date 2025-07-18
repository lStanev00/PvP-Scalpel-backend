import { searchCharFromMap } from "../../../caching/searchCache/charSearchCache.js";
import { searchRealmFromMap } from "../../../caching/searchCache/realmSearchCach.js";

export default async function queryCharacterBySearch(search) {
    if (typeof search !== "string") {
        console.warn(search + "'s not a string!");
        return undefined
    }
    search = search.toLowerCase();
    let [name, realm, server] = search.split(":");

    name = name.trim();
    realm = realm.trim();
    server = server.trim();

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
