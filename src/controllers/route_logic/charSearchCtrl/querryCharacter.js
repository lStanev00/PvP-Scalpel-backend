import extractCharsBySearch from "./helpers/extractCharacters.js";
import extractRealmsBySearch from "./helpers/extractRealms.js";

export default function queryCharacterBySearch(search) {
    if (typeof search !== "string") {
        console.warn(search + "'s not a string!");
        return undefined
    }
    const initialSearch = search;
    const realmArr = extractRealmsBySearch(search);
    const charArr = extractCharsBySearch(search, realmArr);
    
    return {
        initialSearch: initialSearch,
        realms: realmArr,
        chars: charArr
    }
}