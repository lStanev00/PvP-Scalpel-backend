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
    { _id: false, versionKey: false, timestamps: false },
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

warbandSchema.index({ characters: 1 });
// Support the achievement/timestamp pairs used by the warband candidate query.
warbandSchema.index({ "ACWAches.achId": 1, "ACWAches.completedAt": 1 });

warbandSchema.virtual("members", {
    ref: "Character",
    localField: "characters",
    foreignField: "blizID",
    justOne: false,
});

warbandSchema.set("toObject", { virtuals: true });
warbandSchema.set("toJSON", { virtuals: true });

const Warbands = mongoose.model("warbands", warbandSchema);

export default Warbands;
