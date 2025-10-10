import { Schema, model } from "mongoose";

const charWeeklyLadderSchema = new Schema(
    {
        _id: {
            type: String,
            required: true,
        },
        ratingSnapshot: {
            type: Schema.Types.Mixed,
            default: {},
        },
        weeklyPerformance: {
            blitz: Schema.Types.Mixed, // due to multiple elos for diferent specs
            "2v2": {
                type: Number,
                default: null,
            },
            "3v3": {
                type: Number,
                default: null,
            },
            ss: Schema.Types.Mixed,
            RBG: {
                type: Number,
                default: null,
            },
        },
    },
    { timestamps: true }
);
const charWeeklyLadder = model("CharWeeklyLadder", charWeeklyLadderSchema);
export default  charWeeklyLadder;