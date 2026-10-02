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
    },
    data: {
        default: [],
        type: [String]
    },
    scanCursor: { type: String, default: null },
    scanLockToken: { type: String, default: null },
    scanLockUntil: { type: Date, default: null }

})
const Service = mongoose.model("Service", ServiceSchema);

export default Service