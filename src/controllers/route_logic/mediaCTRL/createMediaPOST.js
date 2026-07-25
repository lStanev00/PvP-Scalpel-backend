import { uploadPresignLink } from "../../../caching/CDNCache/CDN/cdn.config.js";
import { jsonMessage, jsonResponse } from "../../../helpers/resposeHelpers.js";
import MediaMeta from "../../../Models/MediaMeta.js";

const QUARANTINE_BUCKET = "quarantine-uploads";
const MAXIMUM_MEDIA_PARTS = 100;
const MAXIMUM_MEDIA_PART_BYTES = 90 * 1024 * 1024;
const MAXIMUM_MEDIA_BYTES = 10 * 1024 * 1024 * 1024;

/**
 * @typedef {Object} MediaPartInput
 * @property {number} index
 * @property {number} start Inclusive byte offset in the original file.
 * @property {number} end Exclusive byte offset in the original file.
 * @property {number} size
 * @property {string} sha256 Lowercase SHA-256 digest of the exact part bytes.
 */

/**
 * @typedef {Object} MediaFileInput
 * @property {string} originalName
 * @property {string} mimeType
 * @property {number} totalBytes
 */

/**
 * @typedef {Object} CreateMediaBody
 * @property {MediaFileInput} file
 * @property {MediaPartInput[]} fileData
 */

/**
 * @typedef {Object} AuthenticatedUser
 * @property {import("mongoose").Types.ObjectId} _id
 * @property {string} role
 */

/**
 * @typedef {import("express").Request<
 *     Record<string, never>,
 *     unknown,
 *     CreateMediaBody
 * > & { user: AuthenticatedUser }} CreateMediaRequest
 */

/**
 * Initializes one integrity-checked multipart media upload.
 *
 * @param {CreateMediaRequest} req
 * @param {import("express").Response} res
 */
export async function createMediaPOST(req, res) {
    let media;

    try {
        const uploadManifest = validateUploadManifest(req.body);

        media = await MediaMeta.create({
            type: "video",
            state: "initializing",
            author: req.user._id,
            manifest: {
                chunksNumber: uploadManifest.parts.length,
                totalBytes: uploadManifest.totalBytes,
                chunkSizes: uploadManifest.parts.map((part) => part.size),
                chunkSha256: uploadManifest.parts.map((part) => part.sha256),
                originalName: uploadManifest.originalName,
                mimeType: uploadManifest.mimeType,
            },
        });

        const uploads = [];
        for (const part of uploadManifest.parts) {
            const keyId = `videos/${media.id}/part_${part.index}`;
            const signingResult = await uploadPresignLink({
                bucket: QUARANTINE_BUCKET,
                keyId,
                mimeType: "application/octet-stream",
            });

            if (!signingResult || typeof signingResult.uploadUrl !== "string") {
                throw new Error(`Storage did not sign media part ${part.index}`);
            }

            uploads.push({
                index: part.index,
                keyId,
                uploadUrl: signingResult.uploadUrl,
            });
        }

        if (uploads.length !== uploadManifest.parts.length) {
            throw new Error("Storage returned an incomplete media upload target set");
        }

        return jsonResponse(res, 201, {
            mediaObj: media.toObject(),
            uploads,
        });
    } catch (error) {
        if (media) {
            await MediaMeta.deleteOne({ _id: media._id }).catch((cleanupError) => {
                console.warn(
                    `[createMediaPOST] failed to remove incomplete media ${media.id}: ${cleanupError.message}`,
                );
            });
        }

        if (
            error instanceof TypeError ||
            error?.name === "ValidationError" ||
            error?.name === "CastError"
        ) {
            return jsonMessage(res, 400, error.message);
        }

        console.error("[createMediaPOST] failed to initialize upload", error);
        return jsonMessage(res, 500, "Failed to initialize media upload");
    }
}

function validateUploadManifest(body) {
    const file = body?.file;
    const parts = body?.fileData;

    if (!file || typeof file !== "object") {
        throw new TypeError("Media upload requires file metadata");
    }
    if (
        !Array.isArray(parts) ||
        parts.length === 0 ||
        parts.length > MAXIMUM_MEDIA_PARTS
    ) {
        throw new TypeError(
            `Media upload requires between 1 and ${MAXIMUM_MEDIA_PARTS} parts`,
        );
    }
    if (
        !Number.isSafeInteger(file.totalBytes) ||
        file.totalBytes <= 0 ||
        file.totalBytes > MAXIMUM_MEDIA_BYTES
    ) {
        throw new TypeError("Media totalBytes is invalid");
    }
    if (
        typeof file.originalName !== "string" ||
        file.originalName.length === 0 ||
        file.originalName.length > 255
    ) {
        throw new TypeError("Media originalName is invalid");
    }
    if (
        typeof file.mimeType !== "string" ||
        !file.mimeType.startsWith("video/") ||
        file.mimeType.length > 127
    ) {
        throw new TypeError("Media mimeType must be a video MIME type");
    }

    let expectedStart = 0;
    const validatedParts = parts.map((part, index) => {
        if (!part || typeof part !== "object" || part.index !== index) {
            throw new TypeError(`Media part ${index} has an invalid index`);
        }
        if (
            !Number.isSafeInteger(part.start) ||
            !Number.isSafeInteger(part.end) ||
            !Number.isSafeInteger(part.size) ||
            part.start !== expectedStart ||
            part.end <= part.start ||
            part.size !== part.end - part.start ||
            part.size > MAXIMUM_MEDIA_PART_BYTES
        ) {
            throw new TypeError(`Media part ${index} has invalid byte boundaries`);
        }
        if (
            typeof part.sha256 !== "string" ||
            !/^[a-f\d]{64}$/.test(part.sha256)
        ) {
            throw new TypeError(`Media part ${index} has an invalid SHA-256 digest`);
        }

        expectedStart = part.end;
        return {
            index,
            start: part.start,
            end: part.end,
            size: part.size,
            sha256: part.sha256,
        };
    });

    if (expectedStart !== file.totalBytes) {
        throw new TypeError("Media parts do not cover the complete original file");
    }

    return {
        originalName: file.originalName,
        mimeType: file.mimeType,
        totalBytes: file.totalBytes,
        parts: validatedParts,
    };
}

export function requireAdmin(req, res, next) {
    if (!req.user) {
        return jsonMessage(res, 401, "Authentication required");
    }

    if (req.user.role !== "admin") {
        return jsonMessage(res, 403, "Non authorized action");
    }

    return next();
}
