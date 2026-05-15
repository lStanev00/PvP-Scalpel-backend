// This will be a sub schema for ../Chars.js

import { Schema } from "mongoose";

const gearItemSchema = new Schema({
    name: {type: String, required: false},
    id: Number,
    media: {type: String, required: false},

    level: Number,
    pvpIlvl: Number,
    bonusList: [Number],

}, { versionKey: true, _id: false });

const GearSchema = new Schema(
    {
        head: Schema.Types.Mixed,
        neck: Schema.Types.Mixed,
        shoulder: Schema.Types.Mixed,
        back: Schema.Types.Mixed,
        chest: Schema.Types.Mixed,
        shirt: Schema.Types.Mixed,
        tabard: Schema.Types.Mixed,
        wrist: Schema.Types.Mixed,
        hands: Schema.Types.Mixed,
        waist: Schema.Types.Mixed,
        legs: Schema.Types.Mixed,
        feet: Schema.Types.Mixed,
        ring1: Schema.Types.Mixed,
        ring2: Schema.Types.Mixed,
        trinket1: Schema.Types.Mixed,
        trinket2: Schema.Types.Mixed,
        wep: Schema.Types.Mixed,
        offHand: Schema.Types.Mixed,
        stats: Schema.Types.Mixed,
    },
    { _id: false, versionKey: false },
);
