import mongoose from "mongoose";

const CFPNotesPostSchema = new mongoose.Schema({
    postId: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    url: { type: String, required: true },
    postedAt: { type: Date, required: true },
    status: {
        type: String,
        required: true,
        enum: ["pending", "review", "approved", "ready", "sending", "published", "dismissed"],
        default: "pending",
    },
    scores: { type: mongoose.Schema.Types.Mixed, default: null },
    reviewMessageId: { type: String, default: null },
    publicMessageId: { type: String, default: null },
    payload: { type: mongoose.Schema.Types.Mixed, default: null },
    lastError: { type: String, default: null },
}, { timestamps: true });
CFPNotesPostSchema.index({ status: 1, postedAt: 1 });

export default mongoose.model("CFPNotesPost", CFPNotesPostSchema);
