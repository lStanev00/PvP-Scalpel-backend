import { createReadStream } from "node:fs";
import { lstat, open, realpath, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import path from "node:path";
import {
    deleteCDNObjects,
    uploadPresignLink,
} from "../../../../caching/CDNCache/CDN/cdn.config.js";

const PUBLIC_BUCKET = "pvp-scalpel-frontend";
const QUARANTINE_BUCKET = "quarantine-uploads";
const PUBLIC_VIDEO_ROOT = "videos";
const WORK_ROOT = "/mnt/work";
const INTERNAL_STORAGE_ENDPOINT =
    process.env.STORAGE_LOCAL_ENDPOINT || "http://minio:4010";
const UPLOAD_TIMEOUT_MS = 60 * 60 * 1000;
const MAXIMUM_DELETE_OBJECTS = 1000;
const PUBLIC_VIDEO_FORMATS = Object.freeze({
    "video/mp4": Object.freeze({ extension: ".mp4", mimeType: "video/mp4" }),
    "video/webm": Object.freeze({ extension: ".webm", mimeType: "video/webm" }),
    "video/ogg": Object.freeze({ extension: ".ogv", mimeType: "video/ogg" }),
});

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
 * @param {string} thumbnailPath Staged local thumbnail path in the form
 * `/mnt/work/<mediaId>/source/thumbnail`.
 * @returns {Promise<PublicMediaCommit>} Public keys and local cleanup status.
 * @throws {TypeError} When IDs, paths, or generated output are invalid.
 * @throws {Error} When validation, presigning, reading, or uploading fails.
 */
export default async function commitMediaToPublic(mediaId, concatResult, thumbnailPath) {
    const normalizedMediaId = normalizeMediaId(mediaId);
    const source = await validateSourceFiles(normalizedMediaId, concatResult, thumbnailPath);
    const publicPrefix = path.posix.join(PUBLIC_VIDEO_ROOT, normalizedMediaId);
    const playlistKey = path.posix.join(publicPrefix, "hls", "index.m3u8");
    const publicThumbnailKey = path.posix.join(
        publicPrefix,
        `thumbnail${thumbnailExtension(source.thumbnailMime)}`,
    );
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

    const { cleanupSucceeded, cleanupMessage } = await cleanupWorkDirectory(
        normalizedMediaId,
        source.workDirectory,
    );

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
 * Publishes one strictly validated original or recovered video with its
 * thumbnail. Original files retain their detected container bytes; recovery
 * outputs are MP4.
 *
 * @param {string} mediaId Twenty-four character MongoDB ObjectId string.
 * @param {string} mediaPath Exact assembled source or validated recovery path.
 * @param {"video/mp4"|"video/webm"|"video/ogg"} mediaMime MIME detected from bytes.
 * @param {string} thumbnailPath Exact staged thumbnail path.
 * @returns {Promise<{
 * bucket: string,
 * prefix: string,
 * videoKey: string,
 * thumbnailKey: string,
 * uploadedKeys: string[],
 * cleanupSucceeded: boolean,
 * cleanupMessage?: string
 * }>}
 */
export async function commitVideoToPublic(
    mediaId,
    mediaPath,
    mediaMime,
    thumbnailPath,
) {
    const normalizedMediaId = normalizeMediaId(mediaId);
    const source = await validateVideoSourceFiles(
        normalizedMediaId,
        mediaPath,
        mediaMime,
        thumbnailPath,
    );
    const publicPrefix = path.posix.join(PUBLIC_VIDEO_ROOT, normalizedMediaId);
    const videoKey = path.posix.join(
        publicPrefix,
        `video${source.videoFormat.extension}`,
    );
    const publicThumbnailKey = path.posix.join(
        publicPrefix,
        `thumbnail${thumbnailExtension(source.thumbnailMime)}`,
    );

    await uploadObject(
        source.thumbnailPath,
        publicThumbnailKey,
        source.thumbnailMime,
    );
    await uploadObject(
        source.mediaPath,
        videoKey,
        source.videoFormat.mimeType,
    );

    const { cleanupSucceeded, cleanupMessage } = await cleanupWorkDirectory(
        normalizedMediaId,
        source.workDirectory,
    );

    return {
        bucket: PUBLIC_BUCKET,
        prefix: publicPrefix,
        videoKey,
        thumbnailKey: publicThumbnailKey,
        uploadedKeys: [publicThumbnailKey, videoKey],
        cleanupSucceeded,
        ...(cleanupMessage ? { cleanupMessage } : {}),
    };
}

/**
 * Backward-compatible MP4 publication wrapper.
 *
 * @deprecated Use `commitVideoToPublic` with an explicitly detected MIME type.
 */
export async function commitComposedMediaToPublic(
    mediaId,
    mediaPath,
    thumbnailPath,
) {
    return await commitVideoToPublic(
        mediaId,
        mediaPath,
        "video/mp4",
        thumbnailPath,
    );
}

/**
 * Resolves one supported public video MIME to its deterministic extension.
 *
 * @param {string} mimeType
 * @returns {{extension: string, mimeType: string}}
 */
export function publicVideoFormat(mimeType) {
    const format = PUBLIC_VIDEO_FORMATS[mimeType];
    if (!format) {
        throw new TypeError(`Unsupported public video MIME type: ${mimeType}`);
    }
    return format;
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
 * @param {string|null|undefined} thumbnailKey Optional quarantine thumbnail key.
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
        const batchNumber = Math.floor(offset / MAXIMUM_DELETE_OBJECTS) + 1;

        try {
            const result = await deleteCDNObjects({
                bucket: QUARANTINE_BUCKET,
                keyIds: batch,
            });

            deletedKeys.push(...result.deletedKeys);
            failedKeys.push(...result.failedKeys);
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            throw new Error(
                `Quarantine deletion batch ${batchNumber} failed: ${message}`,
                { cause: error },
            );
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
    if (
        thumbnailKey !== null &&
        typeof thumbnailKey !== "undefined" &&
        thumbnailKey !== expectedThumbnailKey
    ) {
        throw new TypeError(`Unexpected quarantine thumbnail key: ${thumbnailKey}`);
    }

    return thumbnailKey === expectedThumbnailKey
        ? [...mediaParts, thumbnailKey]
        : [...mediaParts];
}

async function validateSourceFiles(mediaId, concatResult, thumbnailPath) {
    if (!concatResult || typeof concatResult !== "object") {
        throw new TypeError("commitMediaToPublic requires concatToStream output");
    }

    const workDirectory = path.posix.join(WORK_ROOT, mediaId);
    const outputDirectory = path.posix.join(workDirectory, "hls");
    const playlistPath = path.posix.join(outputDirectory, "index.m3u8");
    const expectedThumbnailPath = path.posix.join(
        workDirectory,
        "source",
        "thumbnail",
    );

    if (concatResult.outputDirectory !== outputDirectory) {
        throw new TypeError(`Unexpected HLS output directory: ${concatResult.outputDirectory}`);
    }
    if (concatResult.playlistPath !== playlistPath) {
        throw new TypeError(`Unexpected HLS playlist path: ${concatResult.playlistPath}`);
    }
    if (thumbnailPath !== expectedThumbnailPath) {
        throw new TypeError(`Unexpected thumbnail path: ${thumbnailPath}`);
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

async function validateVideoSourceFiles(
    mediaId,
    mediaPath,
    mediaMime,
    thumbnailPath,
) {
    const workDirectory = path.posix.join(WORK_ROOT, mediaId);
    const sourceMediaPath = path.posix.join(
        workDirectory,
        "source",
        "media.mp4",
    );
    const recoveryPaths = new Set([
        path.posix.join(
            workDirectory,
            "recovery",
            "ffmpeg-recovered.mp4",
        ),
        path.posix.join(workDirectory, "recovery", "recovered.mp4"),
        path.posix.join(workDirectory, "recovery", "structural.mp4"),
    ]);
    const expectedThumbnailPath = path.posix.join(
        workDirectory,
        "source",
        "thumbnail",
    );
    const videoFormat = publicVideoFormat(mediaMime);

    if (mediaPath !== sourceMediaPath && !recoveryPaths.has(mediaPath)) {
        throw new TypeError(`Unexpected public media path: ${mediaPath}`);
    }
    if (recoveryPaths.has(mediaPath) && mediaMime !== "video/mp4") {
        throw new TypeError("Media recovery outputs must be published as video/mp4");
    }
    if (thumbnailPath !== expectedThumbnailPath) {
        throw new TypeError(`Unexpected thumbnail path: ${thumbnailPath}`);
    }

    await verifyRegularFile(mediaPath, "composed media");
    await verifyRegularFile(thumbnailPath, "thumbnail");

    return {
        workDirectory,
        mediaPath,
        videoFormat,
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

function thumbnailExtension(mimeType) {
    switch (mimeType) {
        case "image/jpeg":
            return ".jpg";
        case "image/png":
            return ".png";
        case "image/webp":
            return ".webp";
        default:
            throw new TypeError(`Unsupported public thumbnail MIME type: ${mimeType}`);
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

    let fileStats;
    try {
        fileStats = await lstat(sourcePath);
    } catch (error) {
        throw new Error(`Failed to inspect upload source for ${keyId}`, {
            cause: error,
        });
    }
    if (!fileStats.isFile() || fileStats.isSymbolicLink()) {
        throw new TypeError(`Upload source must be a regular file: ${sourcePath}`);
    }

    let signedUrl;
    try {
        signedUrl = parseSignedUploadUrl(uploadData.uploadUrl, keyId);
    } catch (error) {
        throw new Error(`CDN returned an invalid upload URL for ${keyId}`, {
            cause: error,
        });
    }

    try {
        await uploadThroughInternalStorage(
            signedUrl,
            sourcePath,
            mimeType,
            fileStats.size,
        );
    } catch (error) {
        throw new Error(`Failed to upload ${keyId}`, { cause: error });
    }
}

function uploadThroughInternalStorage(
    signedUrl,
    sourcePath,
    mimeType,
    contentLength,
) {
    const internalEndpoint = parseInternalEndpoint();
    const requestFn =
        internalEndpoint.protocol === "https:" ? httpsRequest : httpRequest;
    const signal = AbortSignal.timeout(UPLOAD_TIMEOUT_MS);

    return new Promise((resolve, reject) => {
        const request = requestFn(
            {
                protocol: internalEndpoint.protocol,
                hostname: internalEndpoint.hostname,
                port: internalEndpoint.port || undefined,
                method: "PUT",
                path: `${signedUrl.pathname}${signedUrl.search}`,
                headers: {
                    Host: signedUrl.host,
                    "Content-Type": mimeType,
                    "Content-Length": String(contentLength),
                },
                signal,
            },
            (response) => {
                response.once("error", (error) => request.destroy(error));
                response.resume();
                response.once("end", () => {
                    if (
                        Number.isInteger(response.statusCode) &&
                        response.statusCode >= 200 &&
                        response.statusCode < 300
                    ) {
                        resolve();
                        return;
                    }
                    reject(
                        new Error(
                            `Storage upload returned HTTP ${response.statusCode || 0}`,
                        ),
                    );
                });
            },
        );
        const body = createReadStream(sourcePath);

        request.once("error", (error) => {
            body.destroy();
            reject(error);
        });
        body.once("error", (error) => request.destroy(error));
        body.pipe(request);
    });
}

function parseInternalEndpoint() {
    const endpoint = new URL(INTERNAL_STORAGE_ENDPOINT);
    if (
        !["http:", "https:"].includes(endpoint.protocol) ||
        endpoint.username ||
        endpoint.password ||
        endpoint.pathname !== "/" ||
        endpoint.search ||
        endpoint.hash
    ) {
        throw new TypeError(
            "STORAGE_LOCAL_ENDPOINT must contain only an HTTP origin",
        );
    }
    return endpoint;
}

function parseSignedUploadUrl(uploadUrl, keyId) {
    const signedUrl = new URL(uploadUrl);
    const expectedPathname = `/${PUBLIC_BUCKET}/${keyId}`;
    if (
        !["http:", "https:"].includes(signedUrl.protocol) ||
        signedUrl.username ||
        signedUrl.password ||
        signedUrl.pathname !== expectedPathname
    ) {
        throw new TypeError("Storage returned an unexpected upload URL");
    }
    return signedUrl;
}

async function cleanupWorkDirectory(mediaId, workDirectory) {
    try {
        await rm(workDirectory, { recursive: true, force: true });
        return { cleanupSucceeded: true };
    } catch (error) {
        const cleanupMessage =
            error instanceof Error ? error.message : String(error);
        console.warn(
            `[commitMediaToPublic][${mediaId}] publication succeeded but local cleanup failed: ${cleanupMessage}`,
        );
        return { cleanupSucceeded: false, cleanupMessage };
    }
}
