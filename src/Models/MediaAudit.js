import { model, Schema } from "mongoose";

const mediaRecoveryStatsSchema = new Schema(
    {
        sourceDurationMs: {
            type: Number,
            min: 0,
            default: 0,
        },
        outputDurationMs: {
            type: Number,
            min: 0,
            default: 0,
        },
        expectedVideoFrames: {
            type: Number,
            min: 0,
            default: 0,
        },
        decodedVideoFrames: {
            type: Number,
            min: 0,
            default: 0,
        },
        goodVideoFrames: {
            type: Number,
            min: 0,
            default: 0,
        },
        outputVideoFrames: {
            type: Number,
            min: 0,
            default: 0,
        },
        duplicatedVideoFrames: {
            type: Number,
            min: 0,
            default: 0,
        },
        corruptVideoFrames: {
            type: Number,
            min: 0,
            default: 0,
        },
        trimmedLeadingMs: {
            type: Number,
            min: 0,
            default: 0,
        },
        trimmedTrailingMs: {
            type: Number,
            min: 0,
            default: 0,
        },
        longestDuplicatedRunMs: {
            type: Number,
            min: 0,
            default: 0,
        },
        insertedAudioSilenceMs: {
            type: Number,
            min: 0,
            default: 0,
        },
        strictValidationPassed: {
            type: Boolean,
            default: false,
        },
        videoCorruptionPercent: {
            type: Number,
            min: 0,
            max: 100,
            default: null,
        },
        audioInsertedSilencePercent: {
            type: Number,
            min: 0,
            max: 100,
            default: null,
        },
    },
    {
        timestamps: false,
        _id: false,
        versionKey: false,
    },
);

const mediaRecoverySchema = new Schema(
    {
        attempted: {
            type: Boolean,
            required: true,
        },
        attempts: {
            type: Number,
            min: 1,
            default: 1,
        },
        lastAttemptAt: {
            type: Date,
            default: null,
        },
        sourceFingerprint: {
            type: String,
            match: /^[a-f\d]{64}$/,
            default: null,
        },
        succeeded: {
            type: Boolean,
            required: true,
        },
        resultVersion: {
            type: Number,
            min: 1,
            default: null,
        },
        engineVersion: {
            type: String,
            maxlength: 64,
            default: null,
        },
        method: {
            type: String,
            enum: ["structural", "salvage", "frame_reconstruction", null],
            default: null,
        },
        reason: {
            type: String,
            required: true,
            maxlength: 128,
        },
        videoRatio: {
            type: Number,
            min: 0,
            max: 1,
            default: null,
        },
        audioRatio: {
            type: Number,
            min: 0,
            max: 1,
            default: null,
        },
        lastError: {
            type: String,
            maxlength: 2048,
            default: null,
        },
        stats: {
            type: mediaRecoveryStatsSchema,
            default: null,
        },
    },
    {
        timestamps: false,
        _id: false,
        versionKey: false,
    },
);

const MediaAuditSchema = new Schema(
    {
        media: {
            type: Schema.Types.ObjectId,
            ref: "MediaMeta",
            required: true,
            unique: true,
            index: true,
        },
        recovery: {
            type: mediaRecoverySchema,
            default: null,
        },
    },
    {
        timestamps: true,
        versionKey: false,
    },
);

const MediaAudit = model("MediaAudit", MediaAuditSchema);
export default MediaAudit;
