import { model, Schema } from "mongoose";
import User from "./User.js";

const VideoCommentsModel = new Schema(
    {
        video: { type: Schema.Types.ObjectId, ref: "MediaMeta", required: true },
        content: { type: String, required: true, trim: true, maxlength: 3000 },
        author: {
            type: Schema.Types.ObjectId,
            ref: User,
            required: true,
        },
        replyTo: {
            type: Schema.Types.ObjectId,
            ref: "VideoComments",
            required: false,
        },
        likes: {
            type: [Schema.Types.ObjectId],
            ref: User,
            default: [],
        },
    },
    { versionKey: false, timestamps: true },
);

const VideoComments = model("VideoComments", VideoCommentsModel);
export default VideoComments;
