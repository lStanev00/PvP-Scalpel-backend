import mongoose from 'mongoose';
const regionSchema = new mongoose.Schema({
    _id: Number,
    name: {
        type: String,
        enum: ['EU', 'US', 'KR', 'TW', "CN"],
        index: true
    },
    slug: {
        type: String,
        enum: ['eu', 'us', 'kr', 'tw', "cn"],
        index: true
    }
}, {_id: false});

const Region = mongoose.model('Region', regionSchema);

export default Region;
