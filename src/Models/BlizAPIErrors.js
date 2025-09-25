import { model, Schema } from "mongoose";

const errorSchema = new Schema({
    url: String,
    status: Number,
    body: String
}, { timestamps: true });

const BlizAPIError = model("BlizAPIError", errorSchema);
export default BlizAPIError;