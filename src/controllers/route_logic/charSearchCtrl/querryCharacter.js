import extractCharsBySearch, { exactCharMatchBySearch } from "./helpers/extractCharacters.js";
import extractRealmsBySearch from "./helpers/extractRealms.js";

export default async function queryCharacterBySearch(search) {
    if (typeof search !== "string") {
        console.warn(search + "'s not a string!");
        return undefined
    }
    const initialSearch = search;
    const exactMatch = await exactCharMatchBySearch(search);
    const realmArr = await extractRealmsBySearch(search);
    const charArr = await extractCharsBySearch(search, realmArr);
    const result = {}

    result.exactMatch = exactMatch;
    result.chars = charArr;
    result.realms = realmArr;
    result.initialSearch = initialSearch;
    return result
}