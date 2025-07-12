import mongoose from "mongoose";
import Char from "./Chars.js";

const searchCharacterSchema = new mongoose.Schema({
    _id: String,
    searchParams: {
        type: String,
        required: true
    },
    searchResult: [String],
    relChars : [{
        type: mongoose.Schema.Types.ObjectId,
        ref: Char
    }]
}, {
    versionKey: false
});

const CharSearchModel = mongoose.model(`CharSearch`, searchCharacterSchema);
export default CharSearchModel;