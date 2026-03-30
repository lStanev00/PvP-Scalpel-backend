import { model, Schema } from "mongoose";

const workerErrorSchema = new Schema(
    {
        workerName: String,
        source: String,
        jobType: String,
        search: String,
        message: { type: String, required: true },
        stack: String,
        context: Schema.Types.Mixed,
    },
    { timestamps: true },
);

const WorkerError = model("WorkerError", workerErrorSchema);
export default WorkerError;
