import mongoose from 'mongoose';

const realmSchema = new mongoose.Schema({
    _id: Number, // Blizzard realm ID
    name: mongoose.Schema.Types.Mixed,
    slug: String,
    timezone: String,
    locale : String,
    region: {
        type: Number,
        ref: "Region",
        index: true
    },
}, { _id: false });

const Realm = mongoose.model('Realm', realmSchema);

export default Realm;
