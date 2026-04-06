import { getCharacter } from "../../../../caching/characters/charCache.js";

export default async function prepareCharData(data) {
    const { search, incChecks, incChechks, renewCache } = data ?? {};
    // console.warn(data);
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

        const [name, realm, server] = search.split(":");
        if (!name || !realm || !server) {
            result.status = 400;
            return result;
        }

        const nextIncChecks = incChecks !== undefined ? incChecks : incChechks;

        result.character = await getCharacter(
            server,
            realm,
            name,
            nextIncChecks !== undefined ? nextIncChecks : true,
            renewCache !== undefined ? renewCache : false,
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
