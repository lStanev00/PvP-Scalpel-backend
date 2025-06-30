import mongoose from "mongoose";

const ServiceSchema = new mongoose.Schema({
    service: {
        type: String,
        required: true,
        unique: true
    },
    running: {
        type: Boolean,
        required: true 
    },
    lastRun: {
        type: Date ,
        default: null,
    },
    msRecords: {
        type: [String],
        default: []
    }

})
const Service = mongoose.model("Service", ServiceSchema);

export default Service