import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { InvalidMediaStreamError } from "./mediaStreamErrors.js";

const WORK_ROOT = "/mnt/work";
const STDERR_TAIL_LIMIT = 16 * 1024;
const PROGRESS_LIMIT = 64 * 1024;
const OPERATIONAL_FFMPEG_PATTERN =
    /(?:no space left on device|cannot allocate memory|resource temporarily unavailable|permission denied|input\/output error|too many open files)/i;
const FFMPEG_TIMEOUT_MS = readPositiveInteger(
    process.env.MEDIA_FFMPEG_TIMEOUT_MS,
    60 * 60 * 1000,
);

/**
 * Strictly decodes every video and audio stream without writing or re-encoding
 * media. A successful check guarantees that FFmpeg decoded at least one video
 * frame from the complete isolated file.
 *
 * @param {string} mediaId Twenty-four character media ID.
 * @param {string} mediaPath Exact staged source or recovery output path.
 * @returns {Promise<{videoFrames: number}>} Strict decode statistics.
 * @throws {InvalidMediaStreamError} When media bytes cannot be fully decoded.
 * @throws {Error} For invalid paths, process failures, resource exhaustion, or timeout.
 */
export default async function validateMediaIntegrity(mediaId, mediaPath) {
    const normalizedMediaId = normalizeMediaId(mediaId);
    const inputPath = resolveMediaPath(normalizedMediaId, mediaPath);
    await verifyRegularFile(inputPath);

    return await runFFmpegValidation(buildFFmpegValidationArgs(inputPath));
}

/**
 * Builds the fixed no-output strict-decode command.
 *
 * @param {string} inputPath
 * @returns {string[]}
 */
export function buildFFmpegValidationArgs(inputPath) {
    return [
        "-hide_banner",
        "-nostdin",
        "-v",
        "error",
        "-xerror",
        "-err_detect",
        "explode",
        "-i",
        inputPath,
        "-map",
        "0:v",
        "-map",
        "0:a?",
        "-progress",
        "pipe:1",
        "-nostats",
        "-f",
        "null",
        "-",
    ];
}

function normalizeMediaId(mediaId) {
    if (typeof mediaId !== "string" || !/^[a-f\d]{24}$/i.test(mediaId)) {
        throw new TypeError(
            "Media integrity validation requires a valid 24-character media ID",
        );
    }

    return mediaId.toLowerCase();
}

function resolveMediaPath(mediaId, mediaPath) {
    const workDirectory = path.posix.join(WORK_ROOT, mediaId);
    const allowedPaths = new Set([
        path.posix.join(workDirectory, "source", "media.mp4"),
        path.posix.join(workDirectory, "recovery", "ffmpeg-recovered.mp4"),
        path.posix.join(workDirectory, "recovery", "recovered.mp4"),
        path.posix.join(workDirectory, "recovery", "structural.mp4"),
    ]);

    if (!allowedPaths.has(mediaPath)) {
        throw new TypeError(
            `Unexpected media integrity validation path: ${mediaPath}`,
        );
    }

    return mediaPath;
}

async function verifyRegularFile(filePath) {
    let metadata;
    let resolvedPath;
    try {
        [metadata, resolvedPath] = await Promise.all([
            lstat(filePath),
            realpath(filePath),
            access(filePath, fsConstants.R_OK),
        ]);
    } catch (error) {
        throw new Error(`Media integrity source is not readable: ${filePath}`, {
            cause: error,
        });
    }

    if (
        !metadata.isFile() ||
        metadata.isSymbolicLink() ||
        resolvedPath !== filePath
    ) {
        throw new TypeError(
            `Media integrity source must be a regular non-symlink file: ${filePath}`,
        );
    }
}

function runFFmpegValidation(args) {
    return new Promise((resolve, reject) => {
        let ffmpeg;
        try {
            ffmpeg = spawn("ffmpeg", args, {
                shell: false,
                stdio: ["ignore", "pipe", "pipe"],
            });
        } catch (error) {
            reject(
                new Error(`Failed to start FFmpeg integrity validation: ${error.message}`, {
                    cause: error,
                }),
            );
            return;
        }

        let settled = false;
        let timedOut = false;
        let progressTail = "";
        let stderrTail = "";
        let videoFrames = 0;
        const timeout = setTimeout(() => {
            timedOut = true;
            ffmpeg.kill("SIGKILL");
        }, FFMPEG_TIMEOUT_MS);

        ffmpeg.stdout.setEncoding("utf8");
        ffmpeg.stdout.on("data", (data) => {
            progressTail = `${progressTail}${data}`.slice(-PROGRESS_LIMIT);
            for (const match of String(data).matchAll(/(?:^|\n)frame=(\d+)/g)) {
                videoFrames = Math.max(videoFrames, Number(match[1]));
            }
        });
        ffmpeg.stderr.setEncoding("utf8");
        ffmpeg.stderr.on("data", (data) => {
            stderrTail = `${stderrTail}${data}`.slice(-STDERR_TAIL_LIMIT);
        });

        ffmpeg.once("error", (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            reject(
                new Error(`Failed to run FFmpeg integrity validation: ${error.message}`, {
                    cause: error,
                }),
            );
        });

        ffmpeg.once("close", (code, signal) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);

            if (timedOut) {
                reject(
                    new Error(
                        `FFmpeg integrity validation exceeded ${FFMPEG_TIMEOUT_MS}ms`,
                    ),
                );
                return;
            }

            const progressFrames = readMaximumFrameCount(progressTail);
            videoFrames = Math.max(videoFrames, progressFrames);
            const details = stderrTail.trim();
            if (code === 0 && videoFrames > 0) {
                resolve({ videoFrames });
                return;
            }

            const exitReason = signal ? `signal ${signal}` : `code ${code}`;
            const message =
                code === 0
                    ? "Media integrity validation decoded no video frames"
                    : `FFmpeg integrity validation exited with ${exitReason}` +
                      `${details ? `: ${details}` : ""}`;

            reject(
                signal || OPERATIONAL_FFMPEG_PATTERN.test(details)
                    ? new Error(message)
                    : new InvalidMediaStreamError(message),
            );
        });
    });
}

function readMaximumFrameCount(progress) {
    let maximum = 0;
    for (const match of progress.matchAll(/(?:^|\n)frame=(\d+)/g)) {
        maximum = Math.max(maximum, Number(match[1]));
    }
    return maximum;
}

function readPositiveInteger(value, fallback) {
    if (typeof value === "undefined" || value === "") return fallback;

    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new TypeError(
            "MEDIA_FFMPEG_TIMEOUT_MS must be a positive safe integer",
        );
    }

    return parsed;
}
