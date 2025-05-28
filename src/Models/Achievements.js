import mongoose from "mongoose";

const achSchema = new mongoose.Schema({
    _id: Number, 
    name: String,
    href: String,
    media: String,
    description: String,
    displayOrder: { type: Number, index: true },
    category: {
        id: { type: Number, index: true },
        name: String,
    },
    criteria: { type: Number, index: true, unique: true },
    expansion: {
        name: String,
        season: Number,
        required: false
    }

});

const Achievement = mongoose.model('Achievement', achSchema);

export default Achievement;