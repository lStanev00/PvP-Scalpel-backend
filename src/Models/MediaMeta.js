import { model, Schema } from "mongoose";
import User from "./User.js";
import Char from "./Chars.js";
import GameBrackets from "./GameBrackets.js";

const manifestSchema = new Schema(
    {
        mediaParts: {
            type: [String],
            default: [],
        },
        chunksNumber: {
            type: Number,
        },
        thumbnail: {
            type: String,
            default: null,
        },
        playlist: {
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
            enum: ["initializing", "uploading", "await_data", "need_process", "processing", "done"],
            required: true,
        },
        quarantined: { type: Boolean, default: false },
        censored: {
            type: Boolean,
            default: false,
        },
        isPrivate: {
            type: Boolean,
            default: false,
        },
        title: {
            type: String,
            default: "",
        },
        description: {
            type: String,
            default: "",
        },
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
            default: 0,
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

async function cacheSavedMedia(doc) {
    if (!doc) return;

    try {
        const { cacheMedia } = await import("../caching/mediaCache/mediaCache.js");
        await cacheMedia(doc);
    } catch (error) {
        console.warn(`Failed to cache MediaMeta ${doc?._id} after data change`);
        console.warn(error);
    }
}

async function cacheMediaFromQuery(query) {
    try {
        const docs = await query.model.find(query.getQuery());

        for (const doc of docs) {
            await cacheSavedMedia(doc);
        }
    } catch (error) {
        console.warn("Failed to refresh MediaMeta cache after query update");
        console.warn(error);
    }
}

MediaMetaSchema.post("save", async function (doc) {
    await cacheSavedMedia(doc);
});

for (const operation of [
    "findOneAndUpdate",
    "findOneAndReplace",
    "updateOne",
    "replaceOne",
    "updateMany",
]) {
    MediaMetaSchema.post(operation, async function () {
        await cacheMediaFromQuery(this);
    });
}

const MediaMeta = model("MediaMeta", MediaMetaSchema);
export default MediaMeta;
