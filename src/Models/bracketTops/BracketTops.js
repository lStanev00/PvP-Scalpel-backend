import { model, Schema } from "mongoose";
import { getGameBracketByID } from "../../caching/gameBrackets/gameBracketsCache.js";

const listEntrySchema = new Schema(
    {
        search: String,
        rating: Number,
    },
    { id: false, versionKey: false, timestamps: false },
);

const BracketTopsSchema = new Schema(
    {
        _id: {
            type: String,
            required: true,
        },
        region: {
            type: Number,
            ref: "Region",
        },
        season: {
            type: Number,
            required: true,
        },
        bracket: {
            type: Number,
            ref: "GameBrackets",
            required: true,
        },
        characters: [listEntrySchema],
    },
    { id: false },
);

BracketTopsSchema.statics.formatQueueEntry = async function formatQueueEntry(blizResponse) {
    const season = blizResponse.season.id || null;
    let BracketTopsId;
    if (!blizResponse.name.includes("blitz") || !blizResponse.name.includes("shuffle")) {
        // 2v2, 3v3, rbg
        const gameBracket = await getGameBracketByID(blizResponse.bracket.id);
        if (!gameBracket) {
            console.warn(
                [
                    `Game Bracket not found at BracketTopsSchema.statics.formatQueueEntry // mem dump ...`,
                    `season: ${JSON.stringify(season, null, 4)}`,
                    `gameBracket: ${JSON.stringify(gameBracket, null, 4)}`,
                ].join("\n"),
            );
        }

        BracketTopsId = gameBracket.slug + ":" + season;
    }
};

const GameBrackets = model("BracketTops", BracketTopsSchema);
export default GameBrackets;
