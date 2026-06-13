import { model, Schema } from "mongoose";
import User from "./User.js";
import Char from "./Chars.js";
import GameBrackets from "./GameBrackets.js";

const manifestSchema = new Schema(
    {
        meidaParts: {
            type: [String],
            default: [],
        },
        thumbnail: {
            type: String,
            default: null,
        },
    },
    {
        timestamps: false,
        _id: false,
        versionKey: false,
    },
);

const MediaMetaSchema = new Schema(
    {
        type: {
            type: String,
            enum: ["video"],
            required: true,
        },
        state: {
            type: String,
            enum: ["initializing", "uploading", "done"],
            required: true,
        },
        isPrivate: {
            type: Boolean,
            default: false,
        },
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
            required: false,
        },
    },
    {
        timestamps: true,
    },
);

const MediaMeta = model("MediaMeta", MediaMetaSchema);
export default MediaMeta;
