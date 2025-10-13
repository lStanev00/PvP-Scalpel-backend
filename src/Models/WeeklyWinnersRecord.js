import { Schema, model } from "mongoose";

const playerResultSchema = new Schema(
    {
        playerSearch: { type: String, required: true },
        result: { type: Number, required: true },
    },
    { _id: false }
);

const weeklyWinnersRecordSchema = new Schema(
    {
        blitz: { type: [playerResultSchema], default: [] },
        "2v2": { type: [playerResultSchema], default: [] },
        "3v3": { type: [playerResultSchema], default: [] },
        shuffle: { type: [playerResultSchema], default: [] },
        RBG: { type: [playerResultSchema], default: [] },
    },
    {
        timestamps: true,
        versionKey: false,
    }
);

const WeeklyWinnersRecord = model("WeeklyWinnersRecord", weeklyWinnersRecordSchema);
export default WeeklyWinnersRecord;
