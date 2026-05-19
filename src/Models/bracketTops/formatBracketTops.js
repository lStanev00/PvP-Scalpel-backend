import Region from "../Regions.js";
import buildCharSearch from "../../helpers/buildCharSearch.js";
import GameBrackets from "../GameBrackets.js";

export default async function formatBracketTops(blizResponse) {
    // This function recives a raw blizzard response and map the data then save it to dbase with season tag
    // the tag looks like - bracketSlug:seasonId:serverSlug

    const serverSlug = blizResponse?._links?.self?.href
        ?.split(".api.")?.[0]
        ?.replace("https://", "")
        ?.trim()
        ?.toLowerCase();

    const seasonID = Number(blizResponse.season.id) || null;
    let BracketTopsId;
    if (!blizResponse.name.includes("blitz") || !blizResponse.name.includes("shuffle")) {
        // 2v2, 3v3, rbg
        const gameBracket = await getGameBracketByID(blizResponse.bracket.id);
        if (!gameBracket) {
            console.warn(
                [
                    `Game Bracket not found at BracketTopsSchema.statics.formatQueueEntry // mem dump ...`,
                    `season: ${JSON.stringify(seasonID, null, 4)}`,
                    `gameBracket: ${JSON.stringify(gameBracket, null, 4)}`,
                ].join("\n"),
            );
        }

        BracketTopsId = [gameBracket.slug, seasonID, serverSlug].join(":");

        const characters = blizResponse.entries.map((entry) => {
            let { name, realm } = entry.character;
            realm = realm.slug;

            const search = buildCharSearch({ name, realm, server: serverSlug });
            const rating = Number(entry.rating);
            const rank = Number(entry.rank);
            return {
                search,
                rating,
                rank,
            };
        });

        const document = new GameBrackets({
            _id: BracketTopsId,
            region: await Region.find({ slug: serverSlug }).lean()._id,
            season: seasonID,
            characters,
        });
    }
}
