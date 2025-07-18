import { searchRegionFromMapBySlug } from "../../../../caching/regions/regionCache.js";
import { searchRealmFromMap } from "../../../../caching/searchCache/realmSearchCach.js";
import convertSearch from "../../../../helpers/convertSearch.js";

export default function extractRealmsBySearch (charSearch) {
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