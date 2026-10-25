import mongoose from "mongoose";

const accWideAchesSchema = new mongoose.Schema({
    _id: Number, 
    name: String,
    href: String,
});

const AccWideAches = mongoose.model('acc_wide_aches', accWideAchesSchema);

export default AccWideAches;