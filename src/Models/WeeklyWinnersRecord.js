import { model, Schema } from "mongoose";

const weeklyWinnersRecordSchema = new Schema({
    blitz: [{ type: { playerSearch: String, result: Number }, default: [] }],
    "2v2": [{ type: { playerSearch: String, result: Number }, default: [] }],
    "3v3": [{ type: { playerSearch: String, result: Number }, default: [] }],
    shuffle: [{ type: { playerSearch: String, result: Number }, default: [] }],
    RBG: [{ type: { playerSearch: String, result: Number }, default: [] }]
}, {
    timestamps: true,
    versionKey: false
});

const WeeklyWinnersRecord = model("WeeklyWinnersRecord", weeklyWinnersRecordSchema);
export default WeeklyWinnersRecord;
