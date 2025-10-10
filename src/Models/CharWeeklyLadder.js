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
    },
    { 
        timestamps: true,
        versionKey: false
    }
);
const charWeeklyLadder = model("CharWeeklyLadder", charWeeklyLadderSchema);
export default charWeeklyLadder;

        // weeklyPerformance: {
        //     blitz: {
        //         type: [[Schema.Types.Mixed]], // each element can be ["name", 10]
        //         default: [],
        //     },
        //     "2v2": {
        //         type: Number,
        //         default: null,
        //     },
        //     "3v3": {
        //         type: Number,
        //         default: null,
        //     },
        //     ss: {
        //         type: [[Schema.Types.Mixed]], // each element can be ["name", 10]
        //         default: [],
        //     },
        //     RBG: {
        //         type: Number,
        //         default: null,
        //     },
        // },