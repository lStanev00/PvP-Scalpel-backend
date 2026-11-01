import { getCharacter } from "../caching/characters/charCache.js";
import helpFetch from "../helpers/blizFetch-helpers/endpointFetchesBliz.js";
import buildCharSearch from "../helpers/buildCharSearch.js";
import threadBoot from "../helpers/threadBoot.js";
import BracketTops from "../Models/bracketTops/BracketTops.js";
import Char from "../Models/Chars.js";
import GameBrackets from "../Models/GameBrackets.js";

await threadBoot(true);
const server = "eu";

const data = await helpFetch.fetchBlizzard(
    `https://${server}.api.blizzard.com/data/wow/pvp-season/${await helpFetch.getCurrentPvPSeasonIndex()}/pvp-leaderboard/?namespace=dynamic-${server}`,
);
const ldbList = data?.leaderboards;
const characterSet = new Set();

for (const { key } of ldbList) {
    const { href } = key;
    const bracketData = await helpFetch.fetchBlizzard(href);

    const entries = bracketData.entries;
    let bracket;
    if (bracketData?.name.includes("blitz")) {
        bracket = await GameBrackets.findById(2);
    } else if (bracketData?.name.includes("shuffle")) {
        bracket = await GameBrackets.findById(1);
    } else {
        bracket = await GameBrackets.findOne({ slug: bracketData.name.toLowerCase() });
    }

    console.info(bracketData.name)
    continue

    for (let i = 0; i < entries.length; i += 8) {
        const currentBatch = entries.slice(i, i + 8);
        const lowElo = currentBatch.find(({ rating }) => rating < 1750);
        if (lowElo) break;
        await Promise.all(
            currentBatch.map(({ character, rating }) => {
                const dock = {
                    server,
                    realm: character.realm.slug,
                    name: character.name,
                };

                const search = buildCharSearch(dock);
                const existingDoc = Char.findOne({ search: server });

                if (existingDoc) {
                    if(bracket?.slug?.name.includes("blitz")) {
                        // logic
                    } else if (bracket?.slug?.name.includes("shuffle")) {
                        // logic
                    } else {

                    }

                }
                if (!search || characterSet.has(search)) return;

                characterSet.add(search);
                return getCharacter(server, dock.realm, dock.name, false, true, true);
            }),
        );
    }

    await BracketTops.formatBracketTops(bracketData);
}
