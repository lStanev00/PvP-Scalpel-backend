import mongoose from "mongoose";
import Char from "./Chars.js";
import autopopulate from 'mongoose-autopopulate';

const searchCharacterSchema = new mongoose.Schema({
    _id: String,
    searchParams: {
        type: String,
        required: true
    },
    searchResult: [String],
    relChars : [{
        type: mongoose.Schema.Types.ObjectId,
        ref: Char,
        autopopulate: { select: "_id name playerRealm server" }
    }]
}, {
    versionKey: false
});

searchCharacterSchema.plugin(autopopulate)

const CharSearchModel = mongoose.model(`CharSearch`, searchCharacterSchema);
export default CharSearchModel;