import mongoose from 'mongoose';

const realmSchema = new mongoose.Schema({
    _id: Number, // Blizzard realm ID
    name: String,
    slug: String,
    type: {
        type: String,
        enum: ['PVE', 'PVP', 'RP', 'RPPVP']
    },
    population: String,
    status: String,
    timezone: String,
    locale: String,
    region: {
        type: String,
        enum: ['EU', 'US', 'KR', 'TW', "CN"],
        index: true
    },
}, { _id: false });

const Realm = mongoose.model('Realm', realmSchema);

export default Realm;
