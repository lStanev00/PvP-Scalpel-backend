import mongoose from "mongoose";

const ACWAchesSchema = new mongoose.Schema(
    {
        achId: {
            type: Number,
            required: true,
        },
        completedAt: {
            type: Number,
            required: true,
        },
    },
    { id: false, versionKey: false, timestamps: false },
);

const warbandSchema = new mongoose.Schema({
    characters: {
        type: [Number],
        default: [],
    },
    ACWAches: {
        type: [ACWAchesSchema],
        default: [],
    },
    // Non required 
    // achindex: {
    //     // sum of the achievement ids (they are Numbers)
    //     type: Number,
    //     index: true,
    //     unique: false,
    // },
    // hashIndex: {
    //     type: String,
    //     required: true,
    //     index: true
    // },
});

const Warbands = mongoose.model("warbands", warbandSchema);

export default Warbands;
