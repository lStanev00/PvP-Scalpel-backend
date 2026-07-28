import { execFile, spawn } from "node:child_process";
import { randomInt } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
    chmod,
    lstat,
    open,
    realpath,
    rename,
    rm,
} from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";

const WORK_ROOT = "/mnt/work";
const STDERR_TAIL_LIMIT = 8 * 1024;
const FFPROBE_TIMEOUT_MS = 60 * 1000;
const THUMBNAIL_TIMEOUT_MS = readPositiveInteger(
    process.env.MEDIA_THUMBNAIL_TIMEOUT_MS,
    2 * 60 * 1000,
);

/**
 * Extracts a representative JPEG frame near a random point in the complete
 * validated local or recovered video. The result fits within 1280x720 without
 * upscaling.
 *
 * @param {string} mediaId Twenty-four character MongoDB ObjectId string.
 * @param {string} mediaPath Exact staged source or validated recovery path.
 * @returns {Promise<string>} Exact generated local thumbnail path.
 */
export default async function generateMediaThumbnail(mediaId, mediaPath) {
    const normalizedMediaId = normalizeMediaId(mediaId);
    const sourceDirectory = path.posix.join(WORK_ROOT, normalizedMediaId, "source");
    const expectedMediaPath = path.posix.join(sourceDirectory, "media.mp4");
    const expectedStructuralPath = path.posix.join(
        WORK_ROOT,
        normalizedMediaId,
        "recovery",
        "structural.mp4",
    );
    const expectedRecoveredPath = path.posix.join(
        WORK_ROOT,
        normalizedMediaId,
        "recovery",
        "recovered.mp4",
    );
    const expectedFFmpegRecoveredPath = path.posix.join(
        WORK_ROOT,
        normalizedMediaId,
        "recovery",
        "ffmpeg-recovered.mp4",
    );
    const thumbnailPath = path.posix.join(sourceDirectory, "thumbnail");
    const partialThumbnailPath = `${thumbnailPath}.partial`;

    if (
        mediaPath !== expectedMediaPath &&
        mediaPath !== expectedStructuralPath &&
        mediaPath !== expectedRecoveredPath &&
        mediaPath !== expectedFFmpegRecoveredPath
    ) {
        throw new TypeError(`Unexpected complete media path: ${mediaPath}`);
    }
    await verifyRegularFile(mediaPath, "thumbnail source");

    const duration = await readDuration(mediaPath);
    const timestamp = selectRandomTimestamp(duration);

    await rm(partialThumbnailPath, { force: true });
    await rm(thumbnailPath, { force: true });

    try {
        await runFFmpeg([
            "-hide_banner",
            "-nostdin",
            "-y",
            "-ss",
            timestamp.toFixed(3),
            "-i",
            mediaPath,
            "-frames:v",
            "1",
            "-an",
            "-vf",
            "thumbnail=30,scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
            "-q:v",
            "2",
            "-vcodec",
            "mjpeg",
            "-f",
            "image2",
            partialThumbnailPath,
        ]);

        await verifyJpeg(partialThumbnailPath);
        await rename(partialThumbnailPath, thumbnailPath);
        await chmod(thumbnailPath, 0o600);
        await verifyRegularFile(thumbnailPath, "generated thumbnail");
        return thumbnailPath;
    } catch (error) {
        await rm(partialThumbnailPath, { force: true }).catch(() => {});
        await rm(thumbnailPath, { force: true }).catch(() => {});
        throw error;
    }
}

async function readDuration(filePath) {
    const execFileAsync = promisify(execFile);
    let stdout;
    try {
        const result = await execFileAsync(
            "ffprobe",
            [
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                filePath,
            ],
            {
                timeout: FFPROBE_TIMEOUT_MS,
                maxBuffer: 1024 * 1024,
            },
        );
        stdout = result.stdout;
    } catch (error) {
        throw new Error(`Failed to inspect the complete media upload: ${error.message}`, {
            cause: error,
        });
    }

    const duration = Number.parseFloat(stdout.trim());
    if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error(
            "The complete media upload has no usable duration for thumbnail generation",
        );
    }

    return duration;
}

function selectRandomTimestamp(duration) {
    if (duration <= 1) return duration / 2;

    const randomFraction = randomInt(0, 1_000_001) / 1_000_000;
    return duration * (0.1 + randomFraction * 0.8);
}

function runFFmpeg(args) {
    return new Promise((resolve, reject) => {
        let ffmpeg;
        try {
            ffmpeg = spawn("ffmpeg", args, {
                stdio: ["ignore", "ignore", "pipe"],
            });
        } catch (error) {
            reject(new Error(`Failed to start thumbnail FFmpeg: ${error.message}`, {
                cause: error,
            }));
            return;
        }

        let stderrTail = "";
        let timedOut = false;
        const timeout = setTimeout(() => {
            timedOut = true;
            ffmpeg.kill("SIGKILL");
        }, THUMBNAIL_TIMEOUT_MS);

        ffmpeg.stderr.setEncoding("utf8");
        ffmpeg.stderr.on("data", (data) => {
            stderrTail = `${stderrTail}${data}`.slice(-STDERR_TAIL_LIMIT);
        });
        ffmpeg.once("error", (error) => {
            clearTimeout(timeout);
            reject(new Error(`Failed to generate media thumbnail: ${error.message}`, {
                cause: error,
            }));
        });
        ffmpeg.once("close", (code, signal) => {
            clearTimeout(timeout);
            if (timedOut) {
                reject(new Error(`Thumbnail generation exceeded ${THUMBNAIL_TIMEOUT_MS}ms`));
                return;
            }
            if (code === 0) {
                resolve();
                return;
            }

            const exitReason = signal ? `signal ${signal}` : `code ${code}`;
            const details = stderrTail.trim();
            reject(
                new Error(
                    `Thumbnail generation exited with ${exitReason}` +
                        `${details ? `: ${details}` : ""}`,
                ),
            );
        });
    });
}

async function verifyJpeg(filePath) {
    await verifyRegularFile(filePath, "generated thumbnail");
    const file = await open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);

    try {
        const header = Buffer.alloc(3);
        const { bytesRead } = await file.read(header, 0, header.length, 0);
        if (
            bytesRead !== header.length ||
            header[0] !== 0xff ||
            header[1] !== 0xd8 ||
            header[2] !== 0xff
        ) {
            throw new Error("Generated thumbnail is not a JPEG file");
        }
    } finally {
        await file.close();
    }
}

async function verifyRegularFile(filePath, label) {
    const [stats, resolvedPath] = await Promise.all([lstat(filePath), realpath(filePath)]);
    if (!stats.isFile() || stats.isSymbolicLink() || resolvedPath !== filePath) {
        throw new Error(`${label} must be a regular non-symlink file: ${filePath}`);
    }
}

function normalizeMediaId(mediaId) {
    if (typeof mediaId !== "string" || !/^[a-f\d]{24}$/i.test(mediaId)) {
        throw new TypeError("Thumbnail generation requires a valid 24-character media ID");
    }

    return mediaId.toLowerCase();
}

function readPositiveInteger(value, fallback) {
    if (typeof value === "undefined" || value === "") return fallback;

    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new TypeError("MEDIA_THUMBNAIL_TIMEOUT_MS must be a positive safe integer");
    }

    return parsed;
}
