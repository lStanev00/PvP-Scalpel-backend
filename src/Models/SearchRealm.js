import mongoose from "mongoose";
import Realm from "./Realms.js";
const searchRealmSchema = new mongoose.Schema({
    _id: String,
    searchParams: {
        type: String,
        required: true
    },
    searchResult: [String],
    relRealms : [{
        type: Number,
        ref: Realm
    }]
}, {
    versionKey: false
});

const RealmSearchModel = mongoose.model(`RealmSearch`, searchRealmSchema);
export default RealmSearchModel;