import mongoose from "mongoose";

const achSchema = new mongoose.Schema({
    _id: Number, // or ObjectId, Number, etc., depending on your custom ID type
    name: String,
    key: String
});

const AchModel = mongoose.model('Achievement', achSchema);

export default AchModel;