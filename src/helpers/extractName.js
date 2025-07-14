export default function extractNameSlug(search) {

    const wholeSearchVal = search
    const WSV_Parts = wholeSearchVal.split(":");

    if(WSV_Parts.length !== 3 ) {
        console.warn(`Bad search value: ${search}`);
        return null
    }

    const key = WSV_Parts[0]; // name extraction

    return key
}