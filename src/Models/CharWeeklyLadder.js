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
            blitz: {
                type: Number,
                default: null,
            },
            "2v2": {
                type: Number,
                default: null,
            },
            "3v3": {
                type: Number,
                default: null,
            },
            ss: {
                type: Number,
                default: null,
            },
            RBG: {
                type: Number,
                default: null,
            },
        },
    },
    { timestamps: true }
);

export default model("CharWeeklyLadder", charWeeklyLadderSchema);
