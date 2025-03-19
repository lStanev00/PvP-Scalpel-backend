import mongoose from 'mongoose';

const ratingSchema = new mongoose.Schema({
    solo: Number,
    solo_bg: Number,
    '2v2': Number,
    '3v3': Number,
    rbg: Number
}, { _id: false });

const achievementsSchema = new mongoose.Schema({
    "2s": { type: mongoose.Schema.Types.Mixed },
    "3s": { type: mongoose.Schema.Types.Mixed },
    BG: { type: mongoose.Schema.Types.Mixed },
  }, { _id: false });

const mediaSchema = new mongoose.Schema({
    avatar: String,
    banner: String,
    charImg: String,
}, { _id: false })

const MemberSchema = new mongoose.Schema({
    blizID: {
        type: Number,
    },
    name: {
        type: String,
        required: [true, `Name is required`],
    },
    playerRealmSlug: {type: String, required: true},
    rank: {
        type: String
    },
    race: String,
    class: String,
    spec: String,
    rating: ratingSchema,
    achieves: achievementsSchema,
    media: mediaSchema


});

const Member = mongoose.model(`Member`, MemberSchema);
export default Member