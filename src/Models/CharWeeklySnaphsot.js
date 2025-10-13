import { Schema, model } from "mongoose";

const ratingPairSchema = new Schema(
    {
        bracketName: { type: String, required: true },
        rating: { type: Number, required: true },
    },
    { _id: false }
);

const charWeeklySnapshotSchema = new Schema(
    {
        _id: {
            type: String,
            required: true
        },
        ratingSnapshot: {
            blitz: {
                type: [ratingPairSchema],
                default: [],
            },
            shuffle: {
                type: [ratingPairSchema],
                default: [],
            },
            "2v2": {
                type: Number,
                default: null,
            },
            "3v3": {
                type: Number,
                default: null,
            },
            RBG: {
                type: Number,
                default: null,
            },
        },
    },
    {
        timestamps: true,
        versionKey: false,
    }
);

const charWeeklySnapshot = model("CharWeeklySnapshot", charWeeklySnapshotSchema);
export default charWeeklySnapshot;
