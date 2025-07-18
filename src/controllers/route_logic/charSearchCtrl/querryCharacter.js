import { searchRegionFromMapBySlug } from "../../../caching/regions/regionCache.js";
import { searchCharFromMap } from "../../../caching/searchCache/charSearchCache.js";
import { searchRealmFromMap } from "../../../caching/searchCache/realmSearchCach.js";
import convertSearch from "../../../helpers/convertSearch.js";

export default function queryCharacterBySearch(search) {
    if (typeof search !== "string") {
        console.warn(search + "'s not a string!");
        return undefined
    }

    const realms = buildRealmsNamesByCharSrch(search);

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

export function buildRealmsNamesByCharSrch (charSearch) {
    if (typeof charSearch !== "string") {
        console.warn(charSearch + "'s not a string!");
        return undefined
    }

    const [name, realm, server] = convertSearch(charSearch);

    const realmSearchMatches = searchRealmFromMap(realm);
    if (!realmSearchMatches) return undefined;
    const serverMatch = (searchRegionFromMapBySlug(server))[0];

    const realmSlugMatch = realmSearchMatches?.relRealms.filter(entry => entry.region == serverMatch);

    const realms = [];

    for (const entry of realmSlugMatch) {
        const result = {
            _id: entry._id,
            server: server,
            slug: entry?.slug,
            
        }
        const realmNames = entry?.["name"];
        const realmLocale = entry?.["locale"];

        const langCheckName = realmNames?.[realmLocale];
        const enGbCheck = realmNames?.["en_GB"];
        
        if (langCheckName !== undefined && enGbCheck !== undefined) {
            result.name = langCheckName === enGbCheck ? langCheckName : `${langCheckName} (${enGbCheck})`;
        } else if (enGbCheck !== undefined) result.name =  enGbCheck

        realms.push(result)
    }

    return realms

}