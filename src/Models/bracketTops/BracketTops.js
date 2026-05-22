import { model, Schema } from "mongoose";
import formatBracketTops from "./formatBracketTops.js";

/**
 * @typedef {import("./BracketTops.types").BracketTopCharacter} BracketTopCharacter
 * @typedef {import("./BracketTops.types").BracketTopsAttrs} BracketTopsAttrs
 * @typedef {import("./BracketTops.types").BlizzardBracketTopResponse} BlizzardBracketTopResponse
 * @typedef {import("./BracketTops.types").FormatBracketTopsStatic} FormatBracketTopsStatic
 * @typedef {import("./BracketTops.types").BracketTopsDocument} BracketTopsDocument
 * @typedef {import("./BracketTops.types").BracketTopsModel} BracketTopsModel
 */

const listEntrySchema = new Schema(
    {
        search: String,
        rating: Number,
        rank: Number,
    },
    { _id: false, versionKey: false, timestamps: false },
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
            required: true,
        },
        season: {
            type: Number,
            required: true,
        },
        class: {
            type: Number,
            ref: "GameClass",
        },
        specialization: {
            type: Number,
            ref: "GameSpecialization",
        },
        bracket: {
            type: Number,
            required: true,
        },
        characters: [listEntrySchema],
    },
    { id: false },
);

BracketTopsSchema.virtual("bracketDoc", {
    ref: "GameBrackets",
    localField: "bracket",
    foreignField: "blizID",
    justOne: true,
});

BracketTopsSchema.statics.formatBracketTops = formatBracketTops;

/** @type {BracketTopsModel} */
const BracketTops = /** @type {BracketTopsModel} */ (model("BracketTops", BracketTopsSchema));
export default BracketTops;
