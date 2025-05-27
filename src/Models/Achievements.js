import mongoose from "mongoose";

const achSchema = new mongoose.Schema({
    _id: Number, 
    name: String,
    href: String
});

const Achievement = mongoose.model('Achievement', achSchema);

export default Achievement;