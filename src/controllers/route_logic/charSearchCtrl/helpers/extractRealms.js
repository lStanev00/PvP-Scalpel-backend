import { getRegionIdsMap, searchRegionFromMapBySlug } from "../../../../caching/regions/regionCache.js";
import { searchRealmFromMap } from "../../../../caching/searchCache/realmSearchCach.js";
import convertSearch from "../../../../helpers/convertSearch.js";

export default async function extractRealmsBySearch (charSearch) {
    if (typeof charSearch !== "string") {
        console.warn(charSearch + "'s not a string!");
        return undefined
    }

    const [name, realm, server] = convertSearch(charSearch);

    if(realm === "!undefined" || ! realm || realm === null) return [];

    let realmSearchMatches = await searchRealmFromMap(realm);
    if (!realmSearchMatches) {
        let match = undefined;
        let inteliRealm = realm.replace(`-`, "").split("");
        if (!(Array.isArray(inteliRealm))) return [];

        for(let i = inteliRealm.length; i >= 2; i--) {
            inteliRealm.pop();
            const checker = await searchRealmFromMap(inteliRealm.join(""));
            
            if (checker) {
                match = checker;
                break;
            }
        }
        if(match) {
            realmSearchMatches = match;
        }
        if(!match) return []; 
    }
    let serverMatch = undefined;
    if(server !== "!undefined") serverMatch = (await searchRegionFromMapBySlug(server))[0];

    // const realmSlugMatch = realmSearchMatches?.relRealms.filter(entry => entry.region == serverMatch);
    const realmSlugMatch = realmSearchMatches?.relRealms

    const realms = [];

    for (const entry of realmSlugMatch) {
        // if (entry === null || !entry) debugger;

        const result = await determinateRealmResult(entry);

        realms.push(result)
    }

    return realms.sort((a, b) => 
        a.slug.length - b.slug.length
    );

}

export async function determinateRealmResult(realm) {
        if(realm === null || !realm) throw new TypeError("Bad input == " + typeof realm); 
        const server = (await getRegionIdsMap()).get(String(realm?.region))?.slug || undefined;
        const result = {
            _id: realm?._id,
            server: server,
            slug: realm?.slug,
        }
        const realmNames = realm?.["name"];
        const realmLocale = realm?.["locale"];

        const langCheckName = realmNames?.[realmLocale];
        const enGbCheck = realmNames?.["en_GB"];
        
        if (langCheckName !== undefined && enGbCheck !== undefined) {
            result.name = langCheckName === enGbCheck ? langCheckName : `${langCheckName} (${enGbCheck})`;
        } else if (enGbCheck !== undefined) result.name =  enGbCheck

        return result
}