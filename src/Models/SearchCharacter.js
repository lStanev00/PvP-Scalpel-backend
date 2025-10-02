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
        autopopulate: { select: "_id name playerRealm server class" }
    }]
}, {
    versionKey: false
});

searchCharacterSchema.pre('save', function(next) {
    if (this.relChars && this.relChars.length > 0) {
        this.relChars = [...new Set(this.relChars.map(v => v.toString()))];
    }
    if (this.searchResult && this.searchResult.length > 0) {
        this.searchResult = [...new Set(this.searchResult)];
    }
    next();
});

searchCharacterSchema.pre('get', function(next) {
    if (this.relChars && this.relChars.length > 0) {
        this.relChars = [...new Set(this.relChars.map(v => v.toString()))];
    }
    if (this.searchResult && this.searchResult.length > 0) {
        this.searchResult = [...new Set(this.searchResult)];
    }
    next();
});

searchCharacterSchema.plugin(autopopulate)

const CharSearchModel = mongoose.model(`CharSearch`, searchCharacterSchema);
export default CharSearchModel;