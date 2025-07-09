import mongoose from 'mongoose';

const realmSchema = new mongoose.Schema({
    _id: Number, // Blizzard realm ID
    name: String,
    slug: String,
    timezone: String,
    region: {
        type: Number,
        ref: "Region",
        index: true
    },
}, { _id: false });

const Realm = mongoose.model('Realm', realmSchema);

export default Realm;
