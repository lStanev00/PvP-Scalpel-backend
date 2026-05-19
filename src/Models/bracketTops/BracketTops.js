import { model, Schema } from "mongoose";
import { getGameBracketByID } from "../../caching/gameBrackets/gameBracketsCache.js";
import formatBracketTops from "./formatBracketTops.js";

const listEntrySchema = new Schema(
    {
        search: String,
        rating: Number,
        rank: Number,
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

BracketTopsSchema.statics.formatBracketTops = formatBracketTops;

const GameBrackets = model("BracketTops", BracketTopsSchema);
export default GameBrackets;
