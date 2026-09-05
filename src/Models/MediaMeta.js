import { model, Schema } from "mongoose";
import User from "./User.js";
import Char from "./Chars.js";
import GameBrackets from "./GameBrackets.js";
import VideoComments from "./VideoComments.js";
import Post from "./Post.js";

const manifestSchema = new Schema(
    {
        mediaParts: {
            type: [String],
            default: [],
        },
        chunksNumber: {
            type: Number,
        },
        totalBytes: {
            type: Number,
        },
        chunkSizes: {
            type: [Number],
            default: [],
        },
        chunkSha256: {
            type: [String],
            default: [],
        },
        originalName: {
            type: String,
        },
        mimeType: {
            type: String,
        },
        thumbnail: {
            type: String,
            default: null,
        },
        playlist: {
            type: String,
            default: null,
        },
        video: {
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
        likes: [
            {
                type: Schema.Types.ObjectId,
                ref: User,
                required: false,
                default: [],
            },
        ],
    },
    {
        timestamps: true,
    },
);


MediaMetaSchema.virtual("comments", {
    ref: Post,
    localField: "_id",
    foreignField: "video",
});

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

async function cacheMediaFromQuery(query, result) {
    try {
        if (result && typeof result.toObject === "function") {
            await cacheSavedMedia(result);
            return;
        }

        const filter = query.getQuery();
        const filteredId = filter?._id;
        const normalizedFilteredId =
            typeof filteredId === "string" ? filteredId : filteredId?.toString?.();
        if (/^[a-f\d]{24}$/i.test(normalizedFilteredId || "")) {
            await cacheSavedMedia(await query.model.findById(normalizedFilteredId));
            return;
        }

        const docs = await query.model.find(filter);

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
    MediaMetaSchema.post(operation, async function (result) {
        await cacheMediaFromQuery(this, result);
    });
}

const MediaMeta = model("MediaMeta", MediaMetaSchema);
export default MediaMeta;
