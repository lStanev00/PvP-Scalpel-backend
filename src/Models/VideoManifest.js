import { model, Schema } from "mongoose";
import User from "./User.js";
import Char from "./Chars.js";
import GameBrackets from "./GameBrackets.js";

const manifestSchema = new Schema(
    {
        videoParts: {
            type: [String],
            default: [],
        },
        thumbnail: {
            type: String,
            required: true,
        },
    },
    {
        timestamps: false,
        _id: false,
    },
);

const VideoMetaSchema = new Schema(
    {
        title: {
            type: String,
            required: true,
        },
        description: String,
        views: {
            type: Number,
            default: 0,
        },
        author: {
            type: Schema.Types.ObjectId,
            ref: User,
        },
        characters: {
            type: [
                {
                    type: Schema.Types.ObjectId,
                    ref: Char,
                },
            ],
            default: [],
        },
        bracket: {
            type: Number,
            ref: GameBrackets,
            required: false,
        },
        manifest: {
            type: manifestSchema,
            required: true
        }
    },
    {
        timestamps: true,
    },
);

const VideoMeta = model("VideoMeta", VideoMetaSchema);
export default VideoMeta;
