import { spawn } from "node:child_process";
import { lstat, mkdir, realpath, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

const WORK_ROOT = "/mnt/work";
const NATIVE_RECOVERY_BINARY =
    process.env.MEDIA_RECOVERY_BINARY || "/usr/local/bin/media-recovery";
const MEDIA_TOOL_ENV = Object.freeze({
    PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
    LANG: "C",
    LC_ALL: "C",
});
const STDERR_TAIL_LIMIT = 8 * 1024;
const STDOUT_LIMIT = 1024 * 1024;
const MAX_RECOVERY_PIXELS = 33_177_600;
const STRUCTURAL_TIMEOUT_MS = readPositiveInteger(
    "MEDIA_RECOVERY_STRUCTURAL_TIMEOUT_MS",
    15 * 60 * 1000,
);
const SALVAGE_TIMEOUT_MS = readPositiveInteger(
    "MEDIA_RECOVERY_SALVAGE_TIMEOUT_MS",
    60 * 60 * 1000,
);
const VALIDATION_TIMEOUT_MS = readPositiveInteger(
    "MEDIA_RECOVERY_VALIDATION_TIMEOUT_MS",
    60 * 60 * 1000,
);
const MIN_VIDEO_RECOVERY_RATIO = readRatio(
    "MEDIA_RECOVERY_MIN_VIDEO_RATIO",
    0.85,
);
const MIN_AUDIO_RECOVERY_RATIO = readRatio(
    "MEDIA_RECOVERY_MIN_AUDIO_RATIO",
    0.75,
);
const MIN_OUTPUT_DURATION_RATIO = readRatio(
    "MEDIA_RECOVERY_MIN_DURATION_RATIO",
    0.98,
);
const SALVAGE_FPS = readBoundedNumber(
    "MEDIA_RECOVERY_FPS",
    30,
    15,
    60,
);

/**
 * Indicates that the recovery service itself failed, rather than the uploaded
 * media being unrecoverable. The parent processing path should retry this case.
 */
export class MediaRecoveryOperationalError extends Error {
    constructor(message, options) {
        super(message, options);
        this.name = "MediaRecoveryOperationalError";
    }
}

/**
 * @typedef {Object} MediaRecoveryResult
 * @property {boolean} succeed Whether a strictly valid recovered file was produced.
 * @property {"structural"|"salvage"|null} method Successful recovery method.
 * @property {string|null} mediaPath Strictly validated recovered file path.
 * @property {string} reason Machine-readable result reason.
 * @property {number|null} videoRatio Estimated recoverable source-video ratio.
 * @property {number|null} audioRatio Estimated recoverable source-audio ratio.
 */

/**
 * Tries a fast native MP4 structural remux, strictly decodes its result, then
 * falls back to tolerant FFmpeg decoding and normalized re-encoding.
 *
 * Uploaded bytes are never executed and are only passed as input to isolated
 * native media tools using argument arrays without a shell.
 *
 * @param {string} mediaId Twenty-four character media ID.
 * @param {string} mediaPath Exact isolated `/mnt/work/<id>/source/media.mp4` path.
 * @returns {Promise<MediaRecoveryResult>} Recovery result or a quality-based failure.
 * @throws {MediaRecoveryOperationalError} When a required native tool, timeout,
 * filesystem operation, or command contract fails.
 */
export default async function recoverCorruptMedia(mediaId, mediaPath) {
    const normalizedMediaId = normalizeMediaId(mediaId);
    const workDirectory = path.posix.join(WORK_ROOT, normalizedMediaId);
    const expectedSourcePath = path.posix.join(
        workDirectory,
        "source",
        "media.mp4",
    );
    const recoveryDirectory = path.posix.join(workDirectory, "recovery");
    const structuralPath = path.posix.join(
        recoveryDirectory,
        "structural.mp4",
    );
    const recoveredPath = path.posix.join(recoveryDirectory, "recovered.mp4");

    if (mediaPath !== expectedSourcePath) {
        throw new TypeError("Recovery requires the exact isolated source-media path");
    }

    await verifyRegularFile(mediaPath, "recovery source");
    await rm(recoveryDirectory, { recursive: true, force: true });
    await mkdir(recoveryDirectory, { recursive: false, mode: 0o700 });
    await verifyDirectory(recoveryDirectory);

    const sourceProbe = await probeMedia(mediaPath);
    if (!sourceProbe) {
        return failedRecovery("recovery_source_unprobeable");
    }

    const structuralCompleted = await attemptStructuralRepair(
        normalizedMediaId,
        mediaPath,
        structuralPath,
    );
    if (structuralCompleted) {
        const structuralValidation = await strictlyValidateMedia(
            structuralPath,
            sourceProbe,
        );
        const structuralQuality = structuralValidation
            ? assessStructuralQuality(sourceProbe, structuralValidation)
            : null;
        if (
            structuralQuality &&
            structuralQuality.videoRatio >= MIN_VIDEO_RECOVERY_RATIO &&
            (
                structuralQuality.audioRatio === null ||
                structuralQuality.audioRatio >= MIN_AUDIO_RECOVERY_RATIO
            )
        ) {
            return {
                succeed: true,
                method: "structural",
                mediaPath: structuralPath,
                reason: "structural_repair_succeeded",
                videoRatio: structuralQuality.videoRatio,
                audioRatio: structuralQuality.audioRatio,
            };
        }
    }

    await rm(structuralPath, { force: true });
    await rm(`${structuralPath.slice(0, -4)}.partial.mp4`, { force: true });
    return await attemptSalvage(
        mediaPath,
        recoveryDirectory,
        recoveredPath,
        sourceProbe,
    );
}

async function attemptStructuralRepair(mediaId, mediaPath, structuralPath) {
    const result = await runProcess(
        NATIVE_RECOVERY_BINARY,
        ["repair", mediaId, mediaPath, structuralPath],
        STRUCTURAL_TIMEOUT_MS,
    );

    if (result.timedOut) return false;
    if (result.code === 0) {
        await verifyRegularFile(structuralPath, "native structural-repair output");
        return true;
    }

    if (result.code === 4 || result.code === 5) {
        return false;
    }

    throw new MediaRecoveryOperationalError(
        `Native structural repair failed with ${formatExit(result)}`,
    );
}

async function attemptSalvage(
    sourcePath,
    recoveryDirectory,
    recoveredPath,
    sourceProbe,
) {
    const recoverableFrames = await countRecoverableVideoFrames(sourcePath);
    const expectedFrames =
        sourceProbe.frameCount ||
        Math.max(1, Math.round(sourceProbe.duration * sourceProbe.frameRate));
    const videoRatio = clampRatio(recoverableFrames / expectedFrames);
    if (videoRatio < MIN_VIDEO_RECOVERY_RATIO) {
        return failedRecovery(
            "recovery_video_below_threshold",
            videoRatio,
            null,
        );
    }

    const videoPath = path.posix.join(recoveryDirectory, "video.mp4");
    const videoCompleted = await salvageVideo(
        sourcePath,
        videoPath,
        sourceProbe.duration,
    );
    if (!videoCompleted) {
        return failedRecovery("recovery_video_salvage_failed", videoRatio, null);
    }

    let audioPath = null;
    let audioRatio = null;
    if (sourceProbe.hasAudio) {
        audioPath = path.posix.join(recoveryDirectory, "audio.m4a");
        const audioCompleted = await salvageAudio(sourcePath, audioPath);
        if (!audioCompleted) {
            return failedRecovery(
                "recovery_audio_salvage_failed",
                videoRatio,
                0,
            );
        }

        const audioProbe = await probeMedia(audioPath, { requireVideo: false });
        audioRatio = audioProbe
            ? clampRatio(audioProbe.duration / sourceProbe.duration)
            : 0;
        if (audioRatio < MIN_AUDIO_RECOVERY_RATIO) {
            return failedRecovery(
                "recovery_audio_below_threshold",
                videoRatio,
                audioRatio,
            );
        }
    }

    const muxCompleted = await createRecoveredMedia(
        videoPath,
        audioPath,
        recoveredPath,
        sourceProbe.duration,
    );
    if (!muxCompleted) {
        return failedRecovery(
            "recovery_final_mux_failed",
            videoRatio,
            audioRatio,
        );
    }
    if (!(await strictlyValidateMedia(recoveredPath, sourceProbe))) {
        return failedRecovery(
            "recovery_strict_validation_failed",
            videoRatio,
            audioRatio,
        );
    }

    return {
        succeed: true,
        method: "salvage",
        mediaPath: recoveredPath,
        reason: "ffmpeg_salvage_succeeded",
        videoRatio,
        audioRatio,
    };
}

async function countRecoverableVideoFrames(sourcePath) {
    const result = await runProcess(
        "ffmpeg",
        [
            "-hide_banner",
            "-nostdin",
            "-protocol_whitelist",
            "file,pipe",
            "-fflags",
            "+discardcorrupt+genpts",
            "-err_detect",
            "ignore_err",
            "-max_pixels",
            String(MAX_RECOVERY_PIXELS),
            "-flags:v",
            "+drop_changed",
            "-i",
            sourcePath,
            "-map",
            "0:v:0",
            "-an",
            "-fps_mode",
            "passthrough",
            "-progress",
            "pipe:1",
            "-nostats",
            "-f",
            "null",
            "-",
        ],
        SALVAGE_TIMEOUT_MS,
    );
    assertDidNotTimeOut(result, "recoverable-frame analysis");

    return readLastProgressFrame(result.stdout);
}

async function salvageVideo(sourcePath, destinationPath, duration) {
    const partialPath = `${destinationPath}.partial.mp4`;
    const durationText = duration.toFixed(3);
    const videoFilter = [
        "setpts=PTS-STARTPTS",
        "scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
        `fps=${SALVAGE_FPS}`,
        `tpad=stop_mode=clone:stop_duration=${durationText}`,
        `trim=duration=${durationText}`,
    ].join(",");

    return await runFFmpegOutput(
        [
            "-hide_banner",
            "-nostdin",
            "-y",
            "-protocol_whitelist",
            "file,pipe",
            "-fflags",
            "+discardcorrupt+genpts",
            "-err_detect",
            "ignore_err",
            "-max_pixels",
            String(MAX_RECOVERY_PIXELS),
            "-flags:v",
            "+drop_changed",
            "-i",
            sourcePath,
            "-map",
            "0:v:0",
            "-an",
            "-vf",
            videoFilter,
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            "-f",
            "mp4",
            partialPath,
        ],
        partialPath,
        destinationPath,
        "video salvage",
    );
}

async function salvageAudio(sourcePath, destinationPath) {
    const partialPath = `${destinationPath}.partial.m4a`;
    return await runFFmpegOutput(
        [
            "-hide_banner",
            "-nostdin",
            "-y",
            "-protocol_whitelist",
            "file,pipe",
            "-fflags",
            "+discardcorrupt+genpts",
            "-err_detect",
            "ignore_err",
            "-flags:a",
            "+drop_changed",
            "-i",
            sourcePath,
            "-map",
            "0:a:0",
            "-vn",
            "-af",
            "aresample=async=1000:first_pts=0",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-ar",
            "48000",
            "-ac",
            "2",
            "-movflags",
            "+faststart",
            "-f",
            "mp4",
            partialPath,
        ],
        partialPath,
        destinationPath,
        "audio salvage",
    );
}

async function createRecoveredMedia(
    videoPath,
    audioPath,
    destinationPath,
    duration,
) {
    const partialPath = `${destinationPath}.partial.mp4`;
    const argumentsList = [
        "-hide_banner",
        "-nostdin",
        "-y",
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        videoPath,
    ];
    if (audioPath) {
        argumentsList.push("-i", audioPath);
    }
    argumentsList.push("-map", "0:v:0");
    if (audioPath) {
        argumentsList.push(
            "-map",
            "1:a:0",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-af",
            "apad",
        );
    }
    argumentsList.push(
        "-c:v",
        "copy",
        "-t",
        duration.toFixed(3),
        "-avoid_negative_ts",
        "make_zero",
        "-movflags",
        "+faststart",
        "-f",
        "mp4",
        partialPath,
    );

    return await runFFmpegOutput(
        argumentsList,
        partialPath,
        destinationPath,
        "recovered-media mux",
    );
}

async function runFFmpegOutput(
    argumentsList,
    partialPath,
    destinationPath,
    label,
) {
    await rm(partialPath, { force: true });
    await rm(destinationPath, { force: true });
    const result = await runProcess("ffmpeg", argumentsList, SALVAGE_TIMEOUT_MS);
    assertDidNotTimeOut(result, label);
    if (result.code !== 0) {
        await rm(partialPath, { force: true }).catch(() => {});
        return false;
    }

    try {
        await verifyRegularFile(partialPath, `${label} output`);
        const outputStats = await stat(partialPath);
        if (outputStats.size < 1_024) {
            await rm(partialPath, { force: true });
            return false;
        }
        await rename(partialPath, destinationPath);
        await verifyRegularFile(destinationPath, `${label} output`);
        return true;
    } catch (error) {
        await rm(partialPath, { force: true }).catch(() => {});
        throw new MediaRecoveryOperationalError(
            `Failed to commit ${label} output: ${error.message}`,
            { cause: error },
        );
    }
}

async function strictlyValidateMedia(mediaPath, sourceProbe) {
    const decodeResult = await runProcess(
        "ffmpeg",
        [
            "-hide_banner",
            "-nostdin",
            "-v",
            "error",
            "-xerror",
            "-max_pixels",
            String(MAX_RECOVERY_PIXELS),
            "-protocol_whitelist",
            "file,pipe",
            "-i",
            mediaPath,
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
            "-progress",
            "pipe:1",
            "-nostats",
            "-f",
            "null",
            "-",
        ],
        VALIDATION_TIMEOUT_MS,
    );
    assertDidNotTimeOut(decodeResult, "strict recovery validation");
    if (decodeResult.code !== 0) return null;

    const recoveredProbe = await probeMedia(mediaPath);
    if (!recoveredProbe) return null;
    const durationRatio = recoveredProbe.duration / sourceProbe.duration;
    if (
        durationRatio < MIN_OUTPUT_DURATION_RATIO ||
        durationRatio > 1 / MIN_OUTPUT_DURATION_RATIO
    ) {
        return null;
    }
    if (sourceProbe.hasAudio && !recoveredProbe.hasAudio) return null;

    return {
        decodedFrames: readLastProgressFrame(decodeResult.stdout),
        probe: recoveredProbe,
    };
}

async function probeMedia(mediaPath, options = {}) {
    const result = await runProcess(
        "ffprobe",
        [
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-count_packets",
            "-show_entries",
            "format=duration:stream=index,codec_type,avg_frame_rate,nb_frames,nb_read_packets",
            "-of",
            "json",
            mediaPath,
        ],
        VALIDATION_TIMEOUT_MS,
    );
    assertDidNotTimeOut(result, "media probing");
    if (result.code !== 0) return null;

    let probe;
    try {
        probe = JSON.parse(result.stdout);
    } catch (error) {
        throw new MediaRecoveryOperationalError(
            "FFprobe returned malformed recovery metadata",
            { cause: error },
        );
    }

    const duration = Number.parseFloat(probe?.format?.duration);
    const streams = Array.isArray(probe?.streams) ? probe.streams : [];
    const videoStream = streams.find((stream) => stream?.codec_type === "video");
    const audioStream = streams.find((stream) => stream?.codec_type === "audio");
    const hasAudio = Boolean(audioStream);
    if (
        !Number.isFinite(duration) ||
        duration <= 0 ||
        (options.requireVideo !== false && !videoStream)
    ) {
        return null;
    }

    return {
        duration,
        hasAudio,
        frameRate: parseFrameRate(videoStream?.avg_frame_rate),
        frameCount: parseFrameCount(videoStream?.nb_frames),
        videoPacketCount: parseFrameCount(videoStream?.nb_read_packets),
        audioPacketCount: parseFrameCount(audioStream?.nb_read_packets),
    };
}

function assessStructuralQuality(sourceProbe, validation) {
    const expectedFrames =
        sourceProbe.frameCount ||
        sourceProbe.videoPacketCount ||
        Math.max(1, Math.round(sourceProbe.duration * sourceProbe.frameRate));
    const frameRatio = clampRatio(validation.decodedFrames / expectedFrames);
    const videoPacketRatio =
        sourceProbe.videoPacketCount && validation.probe.videoPacketCount
            ? clampRatio(
                validation.probe.videoPacketCount /
                    sourceProbe.videoPacketCount,
            )
            : 1;
    const audioRatio =
        sourceProbe.hasAudio &&
        sourceProbe.audioPacketCount &&
        validation.probe.audioPacketCount
            ? clampRatio(
                validation.probe.audioPacketCount /
                    sourceProbe.audioPacketCount,
            )
            : sourceProbe.hasAudio
                ? 1
                : null;

    return {
        videoRatio: Math.min(frameRatio, videoPacketRatio),
        audioRatio,
    };
}

function runProcess(command, argumentsList, timeoutMs) {
    return new Promise((resolve, reject) => {
        let child;
        try {
            child = spawn(command, argumentsList, {
                env: MEDIA_TOOL_ENV,
                shell: false,
                stdio: ["ignore", "pipe", "pipe"],
            });
        } catch (error) {
            reject(
                new MediaRecoveryOperationalError(
                    `Failed to start required media tool ${command}`,
                    { cause: error },
                ),
            );
            return;
        }

        let settled = false;
        let timedOut = false;
        let outputExceeded = false;
        let stdout = "";
        let stderr = "";
        const timeout = setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
        }, timeoutMs);

        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            if (stdout.length + chunk.length > STDOUT_LIMIT) {
                outputExceeded = true;
                child.kill("SIGKILL");
                return;
            }
            stdout += chunk;
        });
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk) => {
            stderr = `${stderr}${chunk}`.slice(-STDERR_TAIL_LIMIT);
        });

        child.once("error", (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            reject(
                new MediaRecoveryOperationalError(
                    `Failed to run required media tool ${command}`,
                    { cause: error },
                ),
            );
        });
        child.once("close", (code, signal) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            if (outputExceeded) {
                reject(
                    new MediaRecoveryOperationalError(
                        `${command} exceeded the recovery output limit`,
                    ),
                );
                return;
            }
            resolve({
                code,
                signal,
                timedOut,
                stdout,
                stderr,
            });
        });
    });
}

async function verifyRegularFile(filePath, label) {
    try {
        const [fileStats, resolvedPath] = await Promise.all([
            lstat(filePath),
            realpath(filePath),
        ]);
        if (
            !fileStats.isFile() ||
            fileStats.isSymbolicLink() ||
            resolvedPath !== filePath
        ) {
            throw new Error("path is not a regular canonical file");
        }
    } catch (error) {
        throw new MediaRecoveryOperationalError(
            `${label} is not a safe regular file`,
            { cause: error },
        );
    }
}

async function verifyDirectory(directoryPath) {
    try {
        const [directoryStats, resolvedPath] = await Promise.all([
            lstat(directoryPath),
            realpath(directoryPath),
        ]);
        if (
            !directoryStats.isDirectory() ||
            directoryStats.isSymbolicLink() ||
            resolvedPath !== directoryPath
        ) {
            throw new Error("path is not a regular canonical directory");
        }
    } catch (error) {
        throw new MediaRecoveryOperationalError(
            "Recovery directory is not safe",
            { cause: error },
        );
    }
}

function failedRecovery(reason, videoRatio = null, audioRatio = null) {
    return {
        succeed: false,
        method: null,
        mediaPath: null,
        reason,
        videoRatio,
        audioRatio,
    };
}

function normalizeMediaId(mediaId) {
    if (typeof mediaId !== "string" || !/^[a-f\d]{24}$/i.test(mediaId)) {
        throw new TypeError("Media recovery requires a valid 24-character media ID");
    }
    return mediaId.toLowerCase();
}

function parseFrameRate(value) {
    if (typeof value !== "string") return SALVAGE_FPS;
    const [numeratorText, denominatorText] = value.split("/");
    const numerator = Number(numeratorText);
    const denominator = Number(denominatorText);
    const frameRate = numerator / denominator;
    if (!Number.isFinite(frameRate) || frameRate < 1 || frameRate > 240) {
        return SALVAGE_FPS;
    }
    return frameRate;
}

function parseFrameCount(value) {
    const frameCount = Number.parseInt(value, 10);
    return Number.isSafeInteger(frameCount) && frameCount > 0
        ? frameCount
        : null;
}

function readLastProgressFrame(stdout) {
    const frameMatches = [...stdout.matchAll(/^frame=(\d+)$/gm)];
    const frameCount =
        frameMatches.length > 0
            ? Number.parseInt(frameMatches.at(-1)[1], 10)
            : 0;
    return Number.isSafeInteger(frameCount) ? frameCount : 0;
}

function clampRatio(value) {
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.min(1, value);
}

function assertDidNotTimeOut(result, label) {
    if (result.timedOut) {
        throw new MediaRecoveryOperationalError(
            `${label} exceeded its configured timeout`,
        );
    }
}

function formatExit(result) {
    return result.signal ? `signal ${result.signal}` : `code ${result.code}`;
}

function readPositiveInteger(name, fallback) {
    const value = process.env[name];
    if (typeof value === "undefined" || value === "") return fallback;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new TypeError(`${name} must be a positive safe integer`);
    }
    return parsed;
}

function readRatio(name, fallback) {
    const value = process.env[name];
    if (typeof value === "undefined" || value === "") return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
        throw new TypeError(`${name} must be greater than 0 and at most 1`);
    }
    return parsed;
}

function readBoundedNumber(name, fallback, minimum, maximum) {
    const value = process.env[name];
    if (typeof value === "undefined" || value === "") return fallback;
    const parsed = Number(value);
    if (
        !Number.isFinite(parsed) ||
        parsed < minimum ||
        parsed > maximum
    ) {
        throw new TypeError(
            `${name} must be between ${minimum} and ${maximum}`,
        );
    }
    return parsed;
}
