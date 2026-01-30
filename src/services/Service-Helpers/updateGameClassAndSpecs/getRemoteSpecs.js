import helpFetch from "../../../helpers/blizFetch-helpers/endpointFetchesBliz.js";
const fetchBlizzard = helpFetch.fetchBlizzard;

export default async function getRemoteSpecs(remoteClassList) {
    if (!Array.isArray(remoteClassList))
        throw new TypeError(
            "remoteClassList have to be type of array current type is: " + typeof remoteClassList,
        );

    const result = new Map();

    for (const { key } of remoteClassList) {
        const { href } = key;

        const classRemote = await fetchBlizzard(href).catch(() => undefined);
        if (!classRemote) {
            console.warn("Bad Req");
            continue;
        }

        const specList = classRemote.specializations;

        for (const entry of specList) {
            result.set(entry.id, entry);
        }
    }

    return result;
}
