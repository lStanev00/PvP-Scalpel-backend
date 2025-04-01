import mongoose from 'mongoose';

const achievementsSchema = new mongoose.Schema({
    points: { type: mongoose.Schema.Types.Mixed }, // Collected
    "2s": { type: mongoose.Schema.Types.Mixed }, // Collected
    "3s": { type: mongoose.Schema.Types.Mixed }, // Collected
    solo: { type: mongoose.Schema.Types.Mixed }, // Collected
    RBG: { type: mongoose.Schema.Types.Mixed }, // Collected
    Blitz: { type: mongoose.Schema.Types.Mixed }, // Collected
}, { _id: false });

const mediaSchema = new mongoose.Schema({
    avatar: { type: String, default: '' }, // Collected
    banner: { type: String, default: '' }, // Collected
    charImg: { type: String, default: '' }, // Collected
}, { _id: false });

const gearSchema = new mongoose.Schema({ // Collected
    head: mongoose.Schema.Types.Mixed,
    neck: mongoose.Schema.Types.Mixed,
    shoulder: mongoose.Schema.Types.Mixed,
    cloak: mongoose.Schema.Types.Mixed,
    chest: mongoose.Schema.Types.Mixed,
    shirt: mongoose.Schema.Types.Mixed,
    tabard: mongoose.Schema.Types.Mixed,
    wrist: mongoose.Schema.Types.Mixed,
    hands: mongoose.Schema.Types.Mixed,
    waist: mongoose.Schema.Types.Mixed,
    legs: mongoose.Schema.Types.Mixed,
    feet: mongoose.Schema.Types.Mixed,
    ring1: mongoose.Schema.Types.Mixed,
    ring2: mongoose.Schema.Types.Mixed,
    trinket1: mongoose.Schema.Types.Mixed,
    trinket2: mongoose.Schema.Types.Mixed,
    wep: mongoose.Schema.Types.Mixed,
    offHand: mongoose.Schema.Types.Mixed,
    stats: mongoose.Schema.Types.Mixed,
}, { _id: false });

const CharSchema = new mongoose.Schema({
    blizID: { type: Number, required: true }, // Collected
    name: { type: String, required: [true, `Name is required`] }, // Collected
    playerRealm: { // Collected
        name: { type: String, required: true },
        slug: { type: String, required: true }
    },
    level: { type: Number, default: 1 }, // Collected
    faction: { type: String, default: '' }, // Collected
    race: { type: String, default: '' }, // Collected
    class: { // Collected
        name: { type: String, required: true },
        media: { type: String, default: '' }
    },
    activeSpec: { // Collected
        name: { type: String, default: '' },
        media: { type: String, default: '' },
        select: false
    },
    rating: { type: mongoose.Schema.Types.Mixed,
        select: false }, // Collected
    achieves: achievementsSchema, // Collected
    media: mediaSchema, // Collected
    checkedCount: { type: Number, default: 0 },
    server: { type: String, default: '' }, // Collected
    gear: gearSchema, // Collected
    lastLogin: { type: Number,
        select: false }, // Collected
    equipmentStats: mongoose.Schema.Types.Mixed, // Collected
}, { timestamps: true });

CharSchema.virtual("posts", {
    ref: "Post",
    localField: "_id",
    foreignField: "character",
})

CharSchema.set("toObject", {  virtuals: true  });
CharSchema.set("toJSON", {  virtuals: true  });

const Char = mongoose.model(`Character`, CharSchema);
export default Char;
