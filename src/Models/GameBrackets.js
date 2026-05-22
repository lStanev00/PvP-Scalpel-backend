import { model, Schema } from "mongoose";

const GameBracketsSchema = new Schema(
    {
        _id: {
            type: Number,
            required: true,
        },
        blizID: { // this is the real actual blizzard id of the game bracket the main id of the file is used internal for addon and desktopa app to map names/brackets 
            type: Number, // if the during development need relations iwth actual blizzard id this key is the way to relate it to the returned blizzard actual bracket ids
            required: false,
            index: true
        },
        name: {
            type: String,
            required: true,
        },
        slug: {
            type: String,
            required: false
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
