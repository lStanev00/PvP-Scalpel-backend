import { model, Schema } from "mongoose";

const GameBracketsSchema = new Schema(
    {
        _id: {
            type: Number,
            required: true,
        },
        name: {
            type: String,
            required: true,
        },
        isRated: {
            type: Boolean,
            required: true,
        },
        isSolo: {
            type: Boolean,
            required: true,
        },
    },
    { versionKey: false },
);

const GameBrackets = model("GameBrackets", GameBracketsSchema);
export default GameBrackets;
