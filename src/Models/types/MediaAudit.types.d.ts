import type { HydratedDocument, Types } from "mongoose";

export interface MediaRecoveryStatsData {
    sourceDurationMs: number;
    outputDurationMs: number;
    expectedVideoFrames: number;
    decodedVideoFrames: number;
    goodVideoFrames: number;
    outputVideoFrames: number;
    duplicatedVideoFrames: number;
    corruptVideoFrames: number;
    removedVideoFrames: number;
    removedTimelineMs: number;
    trimmedLeadingMs: number;
    trimmedTrailingMs: number;
    longestDuplicatedRunMs: number;
    longestRemovedRunMs: number;
    insertedAudioSilenceMs: number;
    strictValidationPassed: boolean;
    videoCorruptionPercent: number | null;
    audioInsertedSilencePercent: number | null;
}

export interface MediaRecoveryData {
    attempted: boolean;
    attempts: number;
    lastAttemptAt: Date | null;
    sourceFingerprint: string | null;
    succeeded: boolean;
    resultVersion: number | null;
    engineVersion: string | null;
    method: "structural" | "salvage" | "frame_reconstruction" | null;
    reason: string;
    videoRatio: number | null;
    audioRatio: number | null;
    lastError: string | null;
    stats: MediaRecoveryStatsData | null;
}

export interface MediaAuditData {
    media: Types.ObjectId;
    recovery: MediaRecoveryData | null;
    createdAt: Date;
    updatedAt: Date;
}

export type MediaAuditDocument = HydratedDocument<MediaAuditData>;
