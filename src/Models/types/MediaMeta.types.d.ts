import type { HydratedDocument, Types } from "mongoose";

export interface MediaManifestData {
    meidaParts: string[];
    thumbnail: string | null;
}

export interface MediaMetaData {
    type: "video";
    state: "initializing" | "uploading" | "done";
    isPrivate: boolean;
    title: string;
    description?: string;
    views: number;
    author?: Types.ObjectId;
    characters: Types.ObjectId[];
    bracket?: number;
    manifest?: MediaManifestData;
    createdAt: Date;
    updatedAt: Date;
}

export type MediaMetaDocument = HydratedDocument<MediaMetaData>;
