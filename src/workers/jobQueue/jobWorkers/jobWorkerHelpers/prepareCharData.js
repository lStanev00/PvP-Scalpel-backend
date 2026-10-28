/** @typedef {import("../../jobQueue.types.js").RetrieveCharacterJobData} RetrieveCharacterJobData */
/** @typedef {import("../../jobQueue.types.js").RetrieveCharacterResult} RetrieveCharacterResult */
import { getCharacter } from "../../../../caching/characters/charCache.js";
import convertSearch from "../../../../helpers/convertSearch.js";

/**
 * Retrieve character data for publication on Redis job:retrieveCharacter.
 * incChecks takes precedence over the legacy incChechks flag; defaults are
 * incChecks=true, renewCache=false, and minimal=false.
 *
 * @param {RetrieveCharacterJobData} data
 * @returns {Promise<RetrieveCharacterResult>}
 */
export default async function prepareCharData(data) {
    const { search, incChecks, incChechks, renewCache, minimal } = data ?? {};
    // console.warn(data);
    /** @type {RetrieveCharacterResult} */
    const result = {
        search,
        character: null,
        status: 500,
    };

    try {
        if (typeof search !== "string") {
            console.warn(typeof search  +"\n"+ search)
            result.status = 400;
            return result;
        }

        const searchParts = convertSearch(search);
        if (!searchParts) {
            result.status = 400;
            return result;
        }
        const [name, realm, server] = searchParts;

        const nextIncChecks = incChecks !== undefined ? incChecks : incChechks;

        result.character = await getCharacter(
            server,
            realm,
            name,
            nextIncChecks !== undefined ? nextIncChecks : true,
            renewCache !== undefined ? renewCache : false,
            !!minimal,
        );

        result.status =
            result.character === 404 || result.character === null || result.character === undefined
                ? 404
                : 200;
    } catch (error) {
        console.error(error);
        result.status = 500;
    }

    return result;
}
