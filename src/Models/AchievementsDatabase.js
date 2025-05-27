import mongoose from "mongoose";

const achSchema = new mongoose.Schema({
    _id: Number, 
    name: String,
    key: String
});

const Achievements = mongoose.model('Achievement', achSchema);

export default Achievements;