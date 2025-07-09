import mongoose from 'mongoose';
import autopopulate from 'mongoose-autopopulate';

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

// virtual population
regionSchema.virtual('realms', {
    ref: 'Realm',
    localField: '_id',
    foreignField: 'region',
    justOne: false,
    options: { select: 'name slug' },
    autopopulate: true // enable autopopulate
});

// enable virtuals in output
regionSchema.set('toObject', { virtuals: true });
regionSchema.set('toJSON', { virtuals: true });

regionSchema.plugin(autopopulate);

const Region = mongoose.model('Region', regionSchema);

export default Region;
