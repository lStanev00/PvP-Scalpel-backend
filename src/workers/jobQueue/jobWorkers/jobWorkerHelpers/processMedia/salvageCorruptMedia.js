import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
    access,
    chmod,
    lstat,
    mkdir,
    realpath,
    rm,
} from "node:fs/promises";
import path from "node:path";
import {
    InvalidMediaStreamError,
    isInvalidMediaStreamFailure,
} from "./mediaStreamErrors.js";

const WORK_ROOT = "/mnt/work";
const STDERR_TAIL_LIMIT = 16 * 1024;
const MINIMUM_OUTPUT_BYTES = 1_024;
const FFMPEG_TIMEOUT_MS = readPositiveInteger(
    process.env.MEDIA_FFMPEG_TIMEOUT_MS,
    60 * 60 * 1000,
);

/**
 * Runs a tolerant FFmpeg transcode over the exact assembled upload.
 *
 * The output is only a recovery candidate. The caller must strictly decode it
 * before publication.
 *
 * @param {string} mediaId Twenty-four character MongoDB ObjectId string.
 * @param {string} mediaPath Exact assembled source path. Its detected container
 * may be MP4, WebM, or Ogg despite the isolated local filename.
 * @returns {Promise<string>} Isolated FFmpeg recovery output path.
 * @throws {InvalidMediaStreamError} When FFmpeg still rejects the media stream.
 * @throws {Error} When validation, filesystem, process, or timeout handling fails.
 */
export default async function salvageCorruptMedia(mediaId, mediaPath) {
    const normalizedMediaId = normalizeMediaId(mediaId);
    const workDirectory = path.posix.join(WORK_ROOT, normalizedMediaId);
    const sourcePath = path.posix.join(workDirectory, "source", "media.mp4");
    const recoveryDirectory = path.posix.join(workDirectory, "recovery");
    const outputPath = path.posix.join(
        recoveryDirectory,
        "ffmpeg-recovered.mp4",
    );

    if (mediaPath !== sourcePath) {
        throw new TypeError(
            "FFmpeg salvage requires the exact isolated source-media path",
        );
    }

    await verifyRegularFile(sourcePath, "FFmpeg salvage source");
    await prepareRecoveryDirectory(workDirectory, recoveryDirectory);
    await removeStaleOutput(outputPath);
    await runFFmpeg(buildFFmpegSalvageArgs(sourcePath, outputPath));
    await verifyRegularFile(outputPath, "FFmpeg salvage output", true);

    return outputPath;
}

/**
 * Builds the fixed tolerant-transcode argument list.
 *
 * @param {string} inputPath
 * @param {string} outputPath
 * @returns {string[]}
 */
export function buildFFmpegSalvageArgs(inputPath, outputPath) {
    return [
        "-hide_banner",
        "-nostdin",
        "-y",
        "-analyzeduration",
        "200M",
        "-probesize",
        "200M",
        "-fflags",
        "+genpts+discardcorrupt",
        "-err_detect",
        "ignore_err",
        "-i",
        inputPath,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-vf",
        "setpts=PTS-STARTPTS",
        "-af",
        "aresample=async=1:first_pts=0,asetpts=PTS-STARTPTS",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-ar",
        "48000",
        "-movflags",
        "+faststart",
        outputPath,
    ];
}

function normalizeMediaId(mediaId) {
    if (typeof mediaId !== "string" || !/^[a-f\d]{24}$/i.test(mediaId)) {
        throw new TypeError(
            "salvageCorruptMedia requires a valid 24-character media ID",
        );
    }

    return mediaId.toLowerCase();
}

async function prepareRecoveryDirectory(workDirectory, recoveryDirectory) {
    await verifyDirectory(workDirectory, "media work directory");

    try {
        await verifyDirectory(recoveryDirectory, "media recovery directory");
    } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        await mkdir(recoveryDirectory, { mode: 0o700 });
    }

    await verifyDirectory(recoveryDirectory, "media recovery directory");
    await chmod(recoveryDirectory, 0o700);
}

async function verifyDirectory(directoryPath, label) {
    const [metadata, resolvedPath] = await Promise.all([
        lstat(directoryPath),
        realpath(directoryPath),
    ]);
    if (
        !metadata.isDirectory() ||
        metadata.isSymbolicLink() ||
        resolvedPath !== directoryPath
    ) {
        throw new Error(`${label} must be an isolated non-symlink directory`);
    }
}

async function verifyRegularFile(filePath, label, enforceMinimumSize = false) {
    const [metadata, resolvedPath] = await Promise.all([
        lstat(filePath),
        realpath(filePath),
        access(filePath, fsConstants.R_OK),
    ]);
    if (
        !metadata.isFile() ||
        metadata.isSymbolicLink() ||
        resolvedPath !== filePath
    ) {
        throw new Error(`${label} must be a regular non-symlink file`);
    }
    if (enforceMinimumSize && metadata.size < MINIMUM_OUTPUT_BYTES) {
        throw new InvalidMediaStreamError(
            "FFmpeg salvage produced an empty or truncated output",
        );
    }
}

async function removeStaleOutput(outputPath) {
    try {
        const metadata = await lstat(outputPath);
        if (!metadata.isFile() || metadata.isSymbolicLink()) {
            throw new Error(
                "Stale FFmpeg salvage output is not a regular file",
            );
        }
        await rm(outputPath);
    } catch (error) {
        if (error?.code !== "ENOENT") throw error;
    }
}

function runFFmpeg(args) {
    return new Promise((resolve, reject) => {
        let ffmpeg;
        try {
            ffmpeg = spawn("ffmpeg", args, {
                shell: false,
                stdio: ["ignore", "ignore", "pipe"],
            });
        } catch (error) {
            reject(
                new Error(`Failed to start FFmpeg salvage: ${error.message}`, {
                    cause: error,
                }),
            );
            return;
        }

        let settled = false;
        let timedOut = false;
        let stderrTail = "";
        const timeout = setTimeout(() => {
            timedOut = true;
            ffmpeg.kill("SIGKILL");
        }, FFMPEG_TIMEOUT_MS);

        ffmpeg.stderr.setEncoding("utf8");
        ffmpeg.stderr.on("data", (data) => {
            stderrTail = `${stderrTail}${data}`.slice(-STDERR_TAIL_LIMIT);
        });

        ffmpeg.once("error", (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            reject(
                new Error(`Failed to run FFmpeg salvage: ${error.message}`, {
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
                        `FFmpeg salvage exceeded ${FFMPEG_TIMEOUT_MS}ms`,
                    ),
                );
                return;
            }
            if (code === 0) {
                resolve();
                return;
            }

            const exitReason = signal ? `signal ${signal}` : `code ${code}`;
            const details = stderrTail.trim();
            const message =
                `FFmpeg salvage exited with ${exitReason}` +
                `${details ? `: ${details}` : ""}`;

            reject(
                isInvalidMediaStreamFailure(details)
                    ? new InvalidMediaStreamError(message)
                    : new Error(message),
            );
        });
    });
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
