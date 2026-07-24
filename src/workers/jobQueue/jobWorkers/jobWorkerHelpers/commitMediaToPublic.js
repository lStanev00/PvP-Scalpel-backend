import { lstat, open, readFile, realpath, rm } from "node:fs/promises";
import path from "node:path";
import {
    deleteCDNObjects,
    uploadPresignLink,
} from "../../../../caching/CDNCache/CDN/cdn.config.js";

const PUBLIC_BUCKET = "pvp-scalpel-frontend";
const QUARANTINE_BUCKET = "quarantine-uploads";
const PUBLIC_VIDEO_ROOT = "videos";
const WORK_ROOT = "/mnt/work";
const QUARANTINE_ROOT = "/mnt/s3-bucket/quarantine-uploads";
const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const MAXIMUM_DELETE_OBJECTS = 1000;

/**
 * @typedef {Object} HLSOutput
 * @property {string} outputDirectory Absolute directory containing the generated HLS files.
 * @property {string} playlistPath Absolute path to the generated `index.m3u8` playlist.
 * @property {string[]} segmentPaths Ordered absolute paths to generated MPEG-TS segments.
 */

/**
 * @typedef {Object} PublicMediaCommit
 * @property {string} bucket Public bucket receiving the media.
 * @property {string} prefix Public object prefix for the video.
 * @property {string} playlistKey Public HLS playlist object key.
 * @property {string} thumbnailKey Public thumbnail object key.
 * @property {string[]} uploadedKeys Object keys uploaded during the commit.
 * @property {boolean} cleanupSucceeded Whether the local work directory was removed.
 * @property {string} [cleanupMessage] Local cleanup error when publication still succeeded.
 */

/**
 * Publishes generated HLS output and its thumbnail through CDN presigned PUT URLs.
 *
 * Only paths returned by `concatToStream` beneath `/mnt/work/<mediaId>/hls`
 * are accepted. Original user-uploaded `part_*` objects are never read or
 * uploaded. The playlist is uploaded last so it cannot reference missing
 * segments or a missing thumbnail.
 *
 * @param {string} mediaId Twenty-four character MongoDB ObjectId string.
 * @param {HLSOutput} concatResult Generated HLS paths returned by `concatToStream`.
 * @param {string} thumbnailKey Quarantine object key in the form
 * `videos/<mediaId>/thumbnail`.
 * @returns {Promise<PublicMediaCommit>} Public keys and local cleanup status.
 * @throws {TypeError} When IDs, paths, or generated output are invalid.
 * @throws {Error} When validation, presigning, reading, or uploading fails.
 */
export default async function commitMediaToPublic(mediaId, concatResult, thumbnailKey) {
    const normalizedMediaId = normalizeMediaId(mediaId);
    const source = await validateSourceFiles(normalizedMediaId, concatResult, thumbnailKey);
    const publicPrefix = path.posix.join(PUBLIC_VIDEO_ROOT, normalizedMediaId);
    const playlistKey = path.posix.join(publicPrefix, "hls", "index.m3u8");
    const publicThumbnailKey = path.posix.join(publicPrefix, "thumbnail");
    const uploadedKeys = [];

    for (const segmentPath of source.segmentPaths) {
        const segmentKey = path.posix.join(publicPrefix, "hls", path.posix.basename(segmentPath));
        await uploadObject(segmentPath, segmentKey, "video/mp2t");
        uploadedKeys.push(segmentKey);
    }

    await uploadObject(source.thumbnailPath, publicThumbnailKey, source.thumbnailMime);
    uploadedKeys.push(publicThumbnailKey);

    await uploadObject(source.playlistPath, playlistKey, "application/vnd.apple.mpegurl");
    uploadedKeys.push(playlistKey);

    let cleanupSucceeded = true;
    let cleanupMessage;
    try {
        await rm(source.workDirectory, { recursive: true, force: true });
    } catch (error) {
        cleanupSucceeded = false;
        cleanupMessage = error instanceof Error ? error.message : String(error);
        console.warn(
            `[commitMediaToPublic][${normalizedMediaId}] publication succeeded but local cleanup failed: ${cleanupMessage}`,
        );
    }

    return {
        bucket: PUBLIC_BUCKET,
        prefix: publicPrefix,
        playlistKey,
        thumbnailKey: publicThumbnailKey,
        uploadedKeys,
        cleanupSucceeded,
        ...(cleanupMessage ? { cleanupMessage } : {}),
    };
}

/**
 * @typedef {Object} QuarantineCleanupResult
 * @property {string[]} deletedKeys Successfully deleted quarantine object keys.
 * @property {string[]} failedKeys Quarantine keys that could not be deleted.
 */

/**
 * Deletes exact source parts and the thumbnail after a media document is done.
 *
 * The state guard prevents this helper from removing retry sources before the
 * public media keys and terminal state have been persisted.
 *
 * @param {string} mediaId Twenty-four character MongoDB ObjectId string.
 * @param {string[]} mediaParts Ordered quarantine part keys.
 * @param {string} thumbnailKey Quarantine thumbnail key.
 * @param {string} mediaState Current persisted media state.
 * @returns {Promise<QuarantineCleanupResult>} Per-key cleanup result.
 */
export async function deleteQuarantineMedia(
    mediaId,
    mediaParts,
    thumbnailKey,
    mediaState,
) {
    const normalizedMediaId = normalizeMediaId(mediaId);
    if (mediaState !== "done") {
        throw new TypeError("Quarantine media can only be deleted after media state is done");
    }

    const keyIds = validateQuarantineKeys(normalizedMediaId, mediaParts, thumbnailKey);
    const deletedKeys = [];
    const failedKeys = [];

    for (let offset = 0; offset < keyIds.length; offset += MAXIMUM_DELETE_OBJECTS) {
        const batch = keyIds.slice(offset, offset + MAXIMUM_DELETE_OBJECTS);

        try {
            const result = await deleteCDNObjects({
                bucket: QUARANTINE_BUCKET,
                keyIds: batch,
            });

            deletedKeys.push(...result.deletedKeys);
            failedKeys.push(...result.failedKeys);
        } catch {
            failedKeys.push(...batch);
        }
    }

    return {
        deletedKeys: [...new Set(deletedKeys)],
        failedKeys: [...new Set(failedKeys)],
    };
}

function normalizeMediaId(mediaId) {
    if (typeof mediaId !== "string" || !/^[a-f\d]{24}$/i.test(mediaId)) {
        throw new TypeError("commitMediaToPublic requires a valid 24-character media ID");
    }

    return mediaId.toLowerCase();
}

function validateQuarantineKeys(mediaId, mediaParts, thumbnailKey) {
    if (!Array.isArray(mediaParts) || mediaParts.length === 0) {
        throw new TypeError("Quarantine cleanup requires ordered media parts");
    }

    for (let index = 0; index < mediaParts.length; index++) {
        const expectedPartKey = path.posix.join(
            PUBLIC_VIDEO_ROOT,
            mediaId,
            `part_${index}`,
        );
        if (mediaParts[index] !== expectedPartKey) {
            throw new TypeError(`Unexpected quarantine media part: ${mediaParts[index]}`);
        }
    }

    const expectedThumbnailKey = path.posix.join(PUBLIC_VIDEO_ROOT, mediaId, "thumbnail");
    if (thumbnailKey !== expectedThumbnailKey) {
        throw new TypeError(`Unexpected quarantine thumbnail key: ${thumbnailKey}`);
    }

    return [...mediaParts, thumbnailKey];
}

async function validateSourceFiles(mediaId, concatResult, thumbnailKey) {
    if (!concatResult || typeof concatResult !== "object") {
        throw new TypeError("commitMediaToPublic requires concatToStream output");
    }

    const workDirectory = path.posix.join(WORK_ROOT, mediaId);
    const outputDirectory = path.posix.join(workDirectory, "hls");
    const playlistPath = path.posix.join(outputDirectory, "index.m3u8");
    const expectedThumbnailKey = path.posix.join(PUBLIC_VIDEO_ROOT, mediaId, "thumbnail");
    const thumbnailPath = path.posix.join(QUARANTINE_ROOT, expectedThumbnailKey);

    if (concatResult.outputDirectory !== outputDirectory) {
        throw new TypeError(`Unexpected HLS output directory: ${concatResult.outputDirectory}`);
    }
    if (concatResult.playlistPath !== playlistPath) {
        throw new TypeError(`Unexpected HLS playlist path: ${concatResult.playlistPath}`);
    }
    if (thumbnailKey !== expectedThumbnailKey) {
        throw new TypeError(`Unexpected thumbnail key: ${thumbnailKey}`);
    }
    if (!Array.isArray(concatResult.segmentPaths) || concatResult.segmentPaths.length === 0) {
        throw new TypeError("Generated HLS output requires at least one segment");
    }

    const segmentPaths = [...concatResult.segmentPaths].sort();
    const uniqueSegmentPaths = new Set(segmentPaths);
    if (uniqueSegmentPaths.size !== segmentPaths.length) {
        throw new TypeError("Generated HLS output contains duplicate segment paths");
    }

    for (const segmentPath of segmentPaths) {
        const segmentName =
            typeof segmentPath === "string" ? path.posix.basename(segmentPath) : "";
        const expectedSegmentPath = path.posix.join(outputDirectory, segmentName);

        if (
            !/^segment_\d{6}\.ts$/.test(segmentName) ||
            segmentPath !== expectedSegmentPath
        ) {
            throw new TypeError(`Unexpected HLS segment path: ${segmentPath}`);
        }
    }

    await verifyRegularFile(playlistPath, "HLS playlist");
    for (const segmentPath of segmentPaths) {
        await verifyRegularFile(segmentPath, "HLS segment");
    }
    await verifyRegularFile(thumbnailPath, "thumbnail");

    return {
        workDirectory,
        playlistPath,
        segmentPaths,
        thumbnailPath,
        thumbnailMime: await detectThumbnailMime(thumbnailPath),
    };
}

async function verifyRegularFile(filePath, label) {
    let fileStats;
    let resolvedPath;

    try {
        [fileStats, resolvedPath] = await Promise.all([lstat(filePath), realpath(filePath)]);
    } catch (error) {
        throw new Error(`${label} is not readable: ${filePath}`, { cause: error });
    }

    if (!fileStats.isFile() || fileStats.isSymbolicLink() || resolvedPath !== filePath) {
        throw new TypeError(`${label} must be a regular non-symlink file: ${filePath}`);
    }
}

async function detectThumbnailMime(thumbnailPath) {
    const file = await open(thumbnailPath, "r");

    try {
        const buffer = Buffer.alloc(16);
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
        const header = buffer.subarray(0, bytesRead);

        if (
            header.length >= 3 &&
            header[0] === 0xff &&
            header[1] === 0xd8 &&
            header[2] === 0xff
        ) {
            return "image/jpeg";
        }
        if (
            header.length >= 8 &&
            header.subarray(0, 8).equals(
                Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
            )
        ) {
            return "image/png";
        }
        if (
            header.length >= 12 &&
            header.subarray(0, 4).toString("ascii") === "RIFF" &&
            header.subarray(8, 12).toString("ascii") === "WEBP"
        ) {
            return "image/webp";
        }

        throw new TypeError(`Unsupported thumbnail MIME signature: ${thumbnailPath}`);
    } finally {
        await file.close();
    }
}

async function uploadObject(sourcePath, keyId, mimeType) {
    let uploadData;
    try {
        uploadData = await uploadPresignLink({
            bucket: PUBLIC_BUCKET,
            keyId,
            mimeType,
        });
    } catch (error) {
        throw new Error(`Failed to create upload URL for ${keyId}`, { cause: error });
    }

    if (!uploadData || typeof uploadData.uploadUrl !== "string") {
        const reason =
            typeof uploadData?.error === "string" ? `: ${uploadData.error}` : "";
        throw new Error(`CDN did not return an upload URL for ${keyId}${reason}`);
    }

    let body;
    try {
        body = await readFile(sourcePath);
    } catch (error) {
        throw new Error(`Failed to read upload source for ${keyId}`, { cause: error });
    }

    let response;
    try {
        response = await fetch(uploadData.uploadUrl, {
            method: "PUT",
            headers: {
                "Content-Type": mimeType,
            },
            body,
            signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
        });
    } catch (error) {
        throw new Error(`Failed to upload ${keyId}`, { cause: error });
    }

    if (!response.ok) {
        throw new Error(`Failed to upload ${keyId}: HTTP ${response.status}`);
    }
}
