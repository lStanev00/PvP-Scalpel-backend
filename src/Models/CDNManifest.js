import { Schema, model } from "mongoose";

const CDNManifestSchema = new Schema(
    {
        customId: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        version: {
            type: String,
            required: true,
        },
        path: {
            type: String,
            required: true,
        },
    },
    {
        timestamps: true,
    }
);

export default model("CDNManifest", CDNManifestSchema);
