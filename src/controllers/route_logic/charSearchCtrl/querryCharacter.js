import extractCharsBySearch, { exactCharMatchBySearch } from "./helpers/extractCharacters.js";
import extractRealmsBySearch from "./helpers/extractRealms.js";

export default function queryCharacterBySearch(search) {
    if (typeof search !== "string") {
        console.warn(search + "'s not a string!");
        return undefined
    }
    const initialSearch = search;
    const exactMatch = exactCharMatchBySearch(search);
    const realmArr = extractRealmsBySearch(search);
    const charArr = extractCharsBySearch(search, realmArr);
    const result = {}

    result.exactMatch = exactMatch;
    result.chars = charArr;
    result.realms = realmArr;
    result.initialSearch = initialSearch;
    return result
}