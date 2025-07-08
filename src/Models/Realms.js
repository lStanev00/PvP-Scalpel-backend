import mongoose from 'mongoose';

const realmSchema = new mongoose.Schema({
    _id: Number, // use the realm ID from Blizzard as the primary key
    name: String,
    slug: String,
    connectedRealmId: Number,
    type: String,
    population: String,
    status: String,
    timezone: String,
    locale: String,
    region: String,
    category: String,
    hasQueue: Boolean,
    isTournament: Boolean
}, { _id: false }); // disables auto-generation of _id

const Realm = mongoose.model('Realm', realmSchema);

export default Realm;
