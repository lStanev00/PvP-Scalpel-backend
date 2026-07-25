import { constants as fsConstants, createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, mkdir, realpath, rename, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { downloadPresignLink } from "../../../../../caching/CDNCache/CDN/cdn.config.js";

const QUARANTINE_BUCKET = "quarantine-uploads";
const WORK_ROOT = "/mnt/work";
const INTERNAL_STORAGE_ENDPOINT =
    process.env.STORAGE_LOCAL_ENDPOINT || "http://minio:4010";
const DOWNLOAD_TIMEOUT_MS = readPositiveInteger(
    process.env.MEDIA_DOWNLOAD_TIMEOUT_MS,
    10 * 60 * 1000,
);
const MAXIMUM_MEDIA_PARTS = readPositiveInteger(process.env.MEDIA_MAX_PARTS, 100);
const MAXIMUM_MEDIA_PART_BYTES = readPositiveInteger(
    process.env.MEDIA_MAX_PART_BYTES,
    512 * 1024 * 1024,
);
const MAXIMUM_THUMBNAIL_BYTES = readPositiveInteger(
    process.env.MEDIA_MAX_THUMBNAIL_BYTES,
    20 * 1024 * 1024,
);
const MAXIMUM_MEDIA_JOB_BYTES = readPositiveInteger(
    process.env.MEDIA_MAX_JOB_BYTES,
    10 * 1024 * 1024 * 1024,
);

/**
 * @typedef {Object} StagedMedia
 * @property {string} workDirectory Local work root for this media job.
 * @property {string} sourceDirectory Directory containing downloaded quarantine objects.
 * @property {string[]} mediaPartPaths Ordered regular local media-part files.
 * @property {string|null} thumbnailPath Regular local thumbnail file, or null when none was uploaded.
 * @property {number} totalBytes Total downloaded bytes.
 */

/**
 * Downloads exact quarantine objects into an isolated local work directory.
 *
 * Signing is requested through the private storage REST service. Object bytes are
 * fetched directly from the internal MinIO Docker endpoint while preserving the
 * signed public Host header required by AWS Signature V4. Presigned URLs are
 * never logged.
 *
 * @param {string} mediaId Twenty-four character MongoDB ObjectId string.
 * @param {string[]} mediaParts Ordered quarantine object keys.
 * @param {string|null|undefined} thumbnailKey Optional quarantine thumbnail object key.
 * @param {{totalBytes: number, chunkSizes: number[], chunkSha256: string[]}} integrity
 * Expected byte sizes and SHA-256 digests from upload initialization.
 * @returns {Promise<StagedMedia>}
 */
export default async function stageMediaLocally(
    mediaId,
    mediaParts,
    thumbnailKey,
    integrity,
) {
    const normalizedMediaId = normalizeMediaId(mediaId);
    const {
        partKeys,
        partIntegrity,
        totalBytes: expectedTotalBytes,
        validatedThumbnailKey,
    } = validateSourceManifest(
        normalizedMediaId,
        mediaParts,
        thumbnailKey,
        integrity,
    );
    const workDirectory = path.posix.join(WORK_ROOT, normalizedMediaId);
    const sourceDirectory = path.posix.join(workDirectory, "source");
    const mediaPartPaths = [];
    let totalBytes = 0;

    await rm(workDirectory, { recursive: true, force: true });
    await mkdir(sourceDirectory, { recursive: true, mode: 0o700 });
    await assertDirectory(sourceDirectory, workDirectory);

    try {
        for (let index = 0; index < mediaParts.length; index++) {
            const destinationPath = path.posix.join(sourceDirectory, `part_${index}`);
            const downloadedBytes = await downloadObjectToFile(
                partKeys[index],
                destinationPath,
                Math.min(MAXIMUM_MEDIA_PART_BYTES, MAXIMUM_MEDIA_JOB_BYTES - totalBytes),
                partIntegrity[index],
            );

            totalBytes += downloadedBytes;
            mediaPartPaths.push(destinationPath);
        }
        if (totalBytes !== expectedTotalBytes) {
            throw new Error(
                `Staged media size ${totalBytes} does not match expected size ${expectedTotalBytes}`,
            );
        }

        let thumbnailPath = null;
        if (validatedThumbnailKey) {
            thumbnailPath = path.posix.join(sourceDirectory, "thumbnail");
            const downloadedThumbnailBytes = await downloadObjectToFile(
                validatedThumbnailKey,
                thumbnailPath,
                Math.min(MAXIMUM_THUMBNAIL_BYTES, MAXIMUM_MEDIA_JOB_BYTES - totalBytes),
            );
            totalBytes += downloadedThumbnailBytes;
        }

        return {
            workDirectory,
            sourceDirectory,
            mediaPartPaths,
            thumbnailPath,
            totalBytes,
        };
    } catch (error) {
        await rm(workDirectory, { recursive: true, force: true }).catch(() => {});
        throw error;
    }
}

/**
 * Removes one validated media work directory.
 *
 * @param {string} mediaId
 * @returns {Promise<void>}
 */
export async function cleanupLocalMedia(mediaId) {
    const normalizedMediaId = normalizeMediaId(mediaId);
    await rm(path.posix.join(WORK_ROOT, normalizedMediaId), {
        recursive: true,
        force: true,
    });
}

function validateSourceManifest(mediaId, mediaParts, thumbnailKey, integrity) {
    if (
        !Array.isArray(mediaParts) ||
        mediaParts.length === 0 ||
        mediaParts.length > MAXIMUM_MEDIA_PARTS
    ) {
        throw new TypeError(
            `Media staging requires between 1 and ${MAXIMUM_MEDIA_PARTS} ordered parts`,
        );
    }

    const partKeys = mediaParts.map((mediaPart, index) => {
        const expectedKey = `videos/${mediaId}/part_${index}`;
        if (mediaPart !== expectedKey) {
            throw new TypeError(`Unexpected quarantine media part: ${mediaPart}`);
        }
        return expectedKey;
    });
    const totalBytes = integrity?.totalBytes;
    const chunkSizes = integrity?.chunkSizes;
    const chunkSha256 = integrity?.chunkSha256;
    if (
        !Number.isSafeInteger(totalBytes) ||
        totalBytes <= 0 ||
        totalBytes > MAXIMUM_MEDIA_JOB_BYTES ||
        !Array.isArray(chunkSizes) ||
        !Array.isArray(chunkSha256) ||
        chunkSizes.length !== partKeys.length ||
        chunkSha256.length !== partKeys.length
    ) {
        throw new TypeError("Media staging requires a complete integrity manifest");
    }

    let calculatedBytes = 0;
    const partIntegrity = chunkSizes.map((size, index) => {
        const sha256 = chunkSha256[index];
        if (
            !Number.isSafeInteger(size) ||
            size <= 0 ||
            size > MAXIMUM_MEDIA_PART_BYTES ||
            typeof sha256 !== "string" ||
            !/^[a-f\d]{64}$/.test(sha256)
        ) {
            throw new TypeError(`Invalid integrity metadata for media part ${index}`);
        }

        calculatedBytes += size;
        return { size, sha256 };
    });
    if (!Number.isSafeInteger(calculatedBytes) || calculatedBytes !== totalBytes) {
        throw new TypeError("Media part sizes do not match the expected total size");
    }

    const expectedThumbnailKey = `videos/${mediaId}/thumbnail`;
    if (
        thumbnailKey !== null &&
        typeof thumbnailKey !== "undefined" &&
        thumbnailKey !== expectedThumbnailKey
    ) {
        throw new TypeError(`Unexpected quarantine thumbnail key: ${thumbnailKey}`);
    }

    return {
        partKeys,
        partIntegrity,
        totalBytes,
        validatedThumbnailKey: thumbnailKey === expectedThumbnailKey ? thumbnailKey : null,
    };
}

async function downloadObjectToFile(
    keyId,
    destinationPath,
    maximumBytes,
    expectedIntegrity,
) {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
        throw new Error("Media job exceeds the configured local staging size");
    }

    let signingResult;
    try {
        signingResult = await downloadPresignLink({
            bucket: QUARANTINE_BUCKET,
            keyId,
        });
    } catch (error) {
        throw new Error(`Failed to sign quarantine download for ${keyId}`, { cause: error });
    }

    const signedUrl = parseSignedUrl(signingResult.downloadUrl, keyId);
    const partialPath = `${destinationPath}.partial`;
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), DOWNLOAD_TIMEOUT_MS);

    try {
        const response = await requestInternalObject(signedUrl, abortController.signal);
        if (response.statusCode !== 200) {
            response.resume();
            throw new Error(
                `Quarantine download failed for ${keyId} with HTTP ${response.statusCode || 0}`,
            );
        }

        const contentLength = parseContentLength(response.headers["content-length"], keyId);
        if (contentLength > maximumBytes) {
            response.destroy();
            throw new Error(`Quarantine object exceeds the staging limit: ${keyId}`);
        }
        if (expectedIntegrity && contentLength !== expectedIntegrity.size) {
            response.destroy();
            throw new Error(
                `Quarantine object size does not match the upload manifest: ${keyId}`,
            );
        }

        let receivedBytes = 0;
        const sha256 = expectedIntegrity ? createHash("sha256") : null;
        const byteLimiter = new Transform({
            transform(chunk, encoding, callback) {
                receivedBytes += chunk.length;
                if (receivedBytes > contentLength || receivedBytes > maximumBytes) {
                    callback(new Error(`Quarantine download exceeded its declared size: ${keyId}`));
                    return;
                }
                sha256?.update(chunk);
                callback(null, chunk);
            },
        });
        const output = createWriteStream(partialPath, {
            flags:
                fsConstants.O_WRONLY |
                fsConstants.O_CREAT |
                fsConstants.O_EXCL |
                fsConstants.O_NOFOLLOW,
            mode: 0o600,
        });

        await pipeline(response, byteLimiter, output, {
            signal: abortController.signal,
        });
        if (receivedBytes !== contentLength) {
            throw new Error(`Quarantine download was incomplete: ${keyId}`);
        }
        if (expectedIntegrity && sha256.digest("hex") !== expectedIntegrity.sha256) {
            throw new Error(
                `Quarantine object SHA-256 does not match the upload manifest: ${keyId}`,
            );
        }

        await rename(partialPath, destinationPath);
        await assertRegularFile(destinationPath);
        return receivedBytes;
    } catch (error) {
        await rm(partialPath, { force: true }).catch(() => {});
        await rm(destinationPath, { force: true }).catch(() => {});
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

function requestInternalObject(signedUrl, signal) {
    const internalEndpoint = parseInternalEndpoint();
    const requestFn = internalEndpoint.protocol === "https:" ? httpsRequest : httpRequest;

    return new Promise((resolve, reject) => {
        const request = requestFn(
            {
                protocol: internalEndpoint.protocol,
                hostname: internalEndpoint.hostname,
                port: internalEndpoint.port || undefined,
                method: "GET",
                path: `${signedUrl.pathname}${signedUrl.search}`,
                headers: {
                    Host: signedUrl.host,
                },
                signal,
            },
            resolve,
        );

        request.once("error", reject);
        request.end();
    });
}

function parseInternalEndpoint() {
    let internalEndpoint;
    try {
        internalEndpoint = new URL(INTERNAL_STORAGE_ENDPOINT);
    } catch (error) {
        throw new Error("STORAGE_LOCAL_ENDPOINT must be a valid internal HTTP URL", {
            cause: error,
        });
    }

    if (
        !["http:", "https:"].includes(internalEndpoint.protocol) ||
        internalEndpoint.username ||
        internalEndpoint.password ||
        internalEndpoint.pathname !== "/" ||
        internalEndpoint.search ||
        internalEndpoint.hash
    ) {
        throw new Error("STORAGE_LOCAL_ENDPOINT must contain only an HTTP origin");
    }

    return internalEndpoint;
}

function parseSignedUrl(downloadUrl, keyId) {
    let signedUrl;
    try {
        signedUrl = new URL(downloadUrl);
    } catch (error) {
        throw new Error(`Storage returned an invalid download URL for ${keyId}`, {
            cause: error,
        });
    }

    const expectedPathname = `/${QUARANTINE_BUCKET}/${keyId}`;
    if (
        !["http:", "https:"].includes(signedUrl.protocol) ||
        !signedUrl.hostname ||
        signedUrl.pathname !== expectedPathname ||
        !signedUrl.searchParams.has("X-Amz-Credential") ||
        !signedUrl.searchParams.has("X-Amz-Signature")
    ) {
        throw new Error(`Storage returned an invalid signed download URL for ${keyId}`);
    }

    return signedUrl;
}

function parseContentLength(contentLengthHeader, keyId) {
    if (
        typeof contentLengthHeader !== "string" ||
        !/^\d+$/.test(contentLengthHeader)
    ) {
        throw new Error(`Quarantine download has no valid Content-Length: ${keyId}`);
    }

    const contentLength = Number(contentLengthHeader);
    if (!Number.isSafeInteger(contentLength) || contentLength <= 0) {
        throw new Error(`Quarantine download has an invalid size: ${keyId}`);
    }

    return contentLength;
}

async function assertDirectory(directoryPath, expectedParent) {
    const [stats, resolvedDirectory, resolvedParent] = await Promise.all([
        lstat(directoryPath),
        realpath(directoryPath),
        realpath(expectedParent),
    ]);

    if (
        !stats.isDirectory() ||
        stats.isSymbolicLink() ||
        resolvedDirectory !== directoryPath ||
        resolvedParent !== expectedParent ||
        !resolvedDirectory.startsWith(`${resolvedParent}/`)
    ) {
        throw new Error(`Unsafe local media staging directory: ${directoryPath}`);
    }
}

async function assertRegularFile(filePath) {
    const [stats, resolvedPath] = await Promise.all([lstat(filePath), realpath(filePath)]);
    if (!stats.isFile() || stats.isSymbolicLink() || resolvedPath !== filePath) {
        throw new Error(`Staged media must be a regular non-symlink file: ${filePath}`);
    }
}

function normalizeMediaId(mediaId) {
    if (typeof mediaId !== "string" || !/^[a-f\d]{24}$/i.test(mediaId)) {
        throw new TypeError("Media staging requires a valid 24-character media ID");
    }

    return mediaId.toLowerCase();
}

function readPositiveInteger(value, fallback) {
    if (typeof value === "undefined" || value === "") return fallback;

    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new TypeError("Media staging limits must be positive safe integers");
    }

    return parsed;
}
