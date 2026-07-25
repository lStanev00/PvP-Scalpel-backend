import type { HydratedDocument, Types } from "mongoose";

export interface MediaRecoveryData {
    attempted: boolean;
    attempts: number;
    lastAttemptAt: Date | null;
    sourceFingerprint: string | null;
    succeeded: boolean;
    method: "structural" | "salvage" | null;
    reason: string;
    videoRatio: number | null;
    audioRatio: number | null;
    lastError: string | null;
}

export interface MediaManifestData {
    mediaParts: string[];
    chunksNumber?: number;
    totalBytes?: number;
    chunkSizes: number[];
    chunkSha256: string[];
    originalName?: string;
    mimeType?: string;
    thumbnail: string | null;
    playlist?: string | null;
    recovery?: MediaRecoveryData | null;
}

export interface MediaMetaData {
    type: "video";
    state:
        | "initializing"
        | "uploading"
        | "await_data"
        | "need_process"
        | "processing"
        | "done";
    quarantined: boolean;
    censored: boolean;
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
