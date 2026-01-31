import { model, Schema } from "mongoose";

const GameSpellModel = new Schema({
    _id: Number,
    name: {
        type: String,
        required: [true, "Name is required"],
    },
    description: {
        type: String,
        default: undefined,
    },
    media: {
        type: String,
        default: undefined,
    },
}, { versionKey: false });

const GameSpell = model("GameSpell", GameSpellModel);
export default GameSpell;
