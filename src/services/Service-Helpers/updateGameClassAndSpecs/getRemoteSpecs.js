import helpFetch from "../../../helpers/blizFetch-helpers/endpointFetchesBliz.js";

/**
 * Fetches each remote playable class and builds a lookup of its specializations.
 *
 * @param {Array<{ key: { href: string } }>} remoteClassList Blizzard playable class entries.
 * @returns {Promise<Map<number, object>>} Map of specialization ID to Blizzard specialization entry.
 * @throws {TypeError} When `remoteClassList` is not an array.
 */
export default async function getRemoteSpecs(remoteClassList) {
    if (!Array.isArray(remoteClassList))
        throw new TypeError(
            "remoteClassList must be an array. Current type is: " + typeof remoteClassList,
        );

    const result = new Map();

    for (const { key } of remoteClassList) {
        const { href } = key;

        const classRemote = await helpFetch.fetchBlizzard(href).catch(() => undefined);
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