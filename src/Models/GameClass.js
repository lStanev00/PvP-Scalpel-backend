import { model, Schema } from "mongoose";

const GameClassModel = new Schema({
    _id: Number,
    name: {
        type: String,
        required: [true, "Name is required"],
    },
    media: {
        type: String,
        required: [true, "Media string href is required"],
    },
    role: {
        type: String,
        enum: ["tank", "damage", "heal"],
        required: [true, "Role type is required: tank, damage, heal"],
    },
});


const GameClass = model("GameClass", GameClassModel);
export default GameClass;