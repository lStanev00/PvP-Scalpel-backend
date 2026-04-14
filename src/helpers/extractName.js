import convertSearch from "./convertSearch.js";

export default function extractNameSlug(search) {
    const searchParts = convertSearch(search);

    if(!searchParts) {
        console.warn(`Bad search value: ${search}`);
        return null
    }

    const key = searchParts[0]; // name extraction

    return key
}
