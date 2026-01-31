import { model, Schema } from "mongoose";

const GameSpellModel = new Schema({
    _id: Number,
    name: {
        type: String,
        default: null,
    },
    description: {
        type: String,
        required: false,
    },
    media: {
        type: String,
        required: false,
    },
}, { versionKey: false });

const GameSpell = model("GameSpell", GameSpellModel);
export default GameSpell;
