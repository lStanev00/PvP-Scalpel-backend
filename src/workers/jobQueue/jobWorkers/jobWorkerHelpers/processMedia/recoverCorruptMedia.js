import { spawn } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

const WORK_ROOT = "/mnt/work";
const RECOVERY_RESULT_VERSION = 2;
const NATIVE_RECOVERY_BINARY =
    process.env.MEDIA_RECOVERY_BINARY || "/usr/local/bin/media-recovery";
const RECOVERY_TIMEOUT_MS = readPositiveInteger(
    "MEDIA_RECOVERY_TIMEOUT_MS",
    60 * 60 * 1000,
);
const STDOUT_LIMIT = 256 * 1024;
const STDERR_TAIL_LIMIT = 16 * 1024;
const NATIVE_STAGE_LOG_LIMIT = 32;
const NATIVE_STAGE_LINE_LIMIT = 1_024;
const MESSAGE_LIMIT = 2_048;
const NATIVE_STAGE_PATTERN =
    /^\[media-recovery\]\[[a-f\d]{24}\]\[[a-z][a-z\d_-]{0,31}\] .+$/;
const MEDIA_TOOL_ENV = Object.freeze({
    PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
    LANG: "C",
    LC_ALL: "C",
});
const RECOVERY_METHODS = new Set([
    "structural",
    "frame_reconstruction",
]);
const RECOVERY_STAT_FIELDS = Object.freeze([
    "sourceDurationMs",
    "outputDurationMs",
    "expectedVideoFrames",
    "decodedVideoFrames",
    "goodVideoFrames",
    "outputVideoFrames",
    "duplicatedVideoFrames",
    "corruptVideoFrames",
    "removedVideoFrames",
    "removedTimelineMs",
    "trimmedLeadingMs",
    "trimmedTrailingMs",
    "longestDuplicatedRunMs",
    "longestRemovedRunMs",
    "insertedAudioSilenceMs",
]);

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
 * @typedef {Object} MediaRecoveryStats
 * @property {number} sourceDurationMs
 * @property {number} outputDurationMs
 * @property {number} expectedVideoFrames
 * @property {number} decodedVideoFrames
 * @property {number} goodVideoFrames
 * @property {number} outputVideoFrames
 * @property {number} duplicatedVideoFrames
 * @property {number} corruptVideoFrames
 * @property {number} removedVideoFrames
 * @property {number} removedTimelineMs
 * @property {number} trimmedLeadingMs
 * @property {number} trimmedTrailingMs
 * @property {number} longestDuplicatedRunMs
 * @property {number} longestRemovedRunMs
 * @property {number} insertedAudioSilenceMs
 * @property {boolean} strictValidationPassed
 * @property {number|null} videoCorruptionPercent
 * @property {number|null} audioInsertedSilencePercent
 */

/**
 * @typedef {Object} MediaRecoveryResult
 * @property {number} version Native result-contract version.
 * @property {string} engineVersion Native recovery-engine version.
 * @property {boolean} succeed Whether a strictly valid recovered file was produced.
 * @property {"structural"|"frame_reconstruction"|null} method Successful recovery method.
 * @property {string|null} mediaPath Strictly validated recovered file path.
 * @property {string} reason Machine-readable result reason.
 * @property {number|null} videoRatio Informational recovered-video ratio.
 * @property {number|null} audioRatio Informational recovered-audio ratio.
 * @property {MediaRecoveryStats} stats Versioned recovery statistics.
 */

/**
 * Runs the native frame-recovery engine and validates its JSON contract.
 *
 * Recovery percentages are diagnostics only. This adapter never rejects a
 * strictly validated native result because of removed-video or inserted-
 * silence percentages.
 *
 * @param {string} mediaId Twenty-four character media ID.
 * @param {string} mediaPath Exact isolated `/mnt/work/<id>/source/media.mp4` path.
 * @returns {Promise<MediaRecoveryResult>} Completed native recovery decision.
 * @throws {MediaRecoveryOperationalError} When the native process, filesystem,
 * timeout, or JSON contract fails.
 */
export default async function recoverCorruptMedia(mediaId, mediaPath) {
    const normalizedMediaId = normalizeMediaId(mediaId);
    const workDirectory = path.posix.join(WORK_ROOT, normalizedMediaId);
    const expectedSourcePath = path.posix.join(
        workDirectory,
        "source",
        "media.mp4",
    );
    const recoveredPath = path.posix.join(
        workDirectory,
        "recovery",
        "recovered.mp4",
    );

    if (mediaPath !== expectedSourcePath) {
        throw new TypeError(
            "Recovery requires the exact isolated source-media path",
        );
    }

    await verifyRegularFile(mediaPath, "recovery source");

    const processResult = await runNativeRecovery([
        "recover",
        normalizedMediaId,
        expectedSourcePath,
        recoveredPath,
    ]);
    if (processResult.timedOut) {
        throw new MediaRecoveryOperationalError(
            "Native media recovery exceeded its configured timeout",
        );
    }
    if (processResult.code !== 0) {
        const diagnostics = boundedDiagnostics(processResult.stderr);
        throw new MediaRecoveryOperationalError(
            `Native media recovery exited with ${formatExit(processResult)}` +
                `${diagnostics ? `: ${diagnostics}` : ""}`,
        );
    }
    const recovery = parseRecoveryResult(processResult.stdout);
    if (recovery.succeed) {
        await verifyRegularFile(recoveredPath, "native recovery output");
    }

    return {
        ...recovery,
        mediaPath: recovery.succeed ? recoveredPath : null,
    };
}

function runNativeRecovery(argumentsList) {
    return new Promise((resolve, reject) => {
        let child;
        try {
            child = spawn(NATIVE_RECOVERY_BINARY, argumentsList, {
                env: MEDIA_TOOL_ENV,
                shell: false,
                stdio: ["ignore", "pipe", "pipe"],
            });
        } catch (error) {
            reject(
                new MediaRecoveryOperationalError(
                    "Failed to start the native media-recovery engine",
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
        let stderrLineBuffer = "";
        const stageLogs = [];
        const timeout = setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
        }, RECOVERY_TIMEOUT_MS);

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
            stderrLineBuffer += chunk;
            const lines = stderrLineBuffer.split(/\r?\n/);
            stderrLineBuffer = lines.pop() || "";
            for (const line of lines) {
                collectNativeStageLog(stageLogs, line);
            }
            if (stderrLineBuffer.length > NATIVE_STAGE_LINE_LIMIT) {
                stderrLineBuffer = "";
            }
        });

        child.once("error", (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            reject(
                new MediaRecoveryOperationalError(
                    "Failed to run the native media-recovery engine",
                    { cause: error },
                ),
            );
        });
        child.once("close", (code, signal) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            collectNativeStageLog(stageLogs, stderrLineBuffer);
            if (outputExceeded) {
                reject(
                    new MediaRecoveryOperationalError(
                        "Native media recovery exceeded its output limit",
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

function collectNativeStageLog(stageLogs, line) {
    if (
        stageLogs.length >= NATIVE_STAGE_LOG_LIMIT ||
        typeof line !== "string" ||
        line.length > NATIVE_STAGE_LINE_LIMIT ||
        !NATIVE_STAGE_PATTERN.test(line)
    ) {
        return;
    }
    stageLogs.push(line);
    console.info(line);
}

function parseRecoveryResult(stdout) {
    let rawResult;
    try {
        rawResult = JSON.parse(stdout.trim());
    } catch (error) {
        throw new MediaRecoveryOperationalError(
            "Native media recovery returned malformed JSON",
            { cause: error },
        );
    }

    if (!isPlainObject(rawResult)) {
        throw invalidContract("result must be an object");
    }
    if (rawResult.version !== RECOVERY_RESULT_VERSION) {
        throw invalidContract(
            `unsupported result version ${String(rawResult.version)}`,
        );
    }
    if (
        typeof rawResult.engineVersion !== "string" ||
        rawResult.engineVersion.length === 0 ||
        rawResult.engineVersion.length > 64
    ) {
        throw invalidContract("engineVersion must be a bounded string");
    }
    if (typeof rawResult.succeed !== "boolean") {
        throw invalidContract("succeed must be a boolean");
    }
    if (
        rawResult.method !== null &&
        !RECOVERY_METHODS.has(rawResult.method)
    ) {
        throw invalidContract("method is unsupported");
    }
    if (
        (rawResult.succeed && !RECOVERY_METHODS.has(rawResult.method)) ||
        (!rawResult.succeed && rawResult.method !== null)
    ) {
        throw invalidContract("method does not match the recovery outcome");
    }
    if (
        typeof rawResult.reason !== "string" ||
        rawResult.reason.length === 0 ||
        rawResult.reason.length > 128
    ) {
        throw invalidContract("reason must be a bounded string");
    }

    const videoRatio = readOptionalRatio(rawResult.videoRatio, "videoRatio");
    const audioRatio = readOptionalRatio(rawResult.audioRatio, "audioRatio");
    const stats = parseRecoveryStats(rawResult.stats);
    if (
        rawResult.succeed &&
        (
            stats.outputDurationMs <= 0 ||
            stats.outputVideoFrames <= 0 ||
            stats.goodVideoFrames > stats.decodedVideoFrames ||
            stats.goodVideoFrames !== stats.outputVideoFrames ||
            stats.duplicatedVideoFrames !== 0 ||
            stats.longestDuplicatedRunMs !== 0 ||
            (
                rawResult.method === "frame_reconstruction" &&
                stats.removedVideoFrames !== stats.corruptVideoFrames
            ) ||
            stats.strictValidationPassed !== true
        )
    ) {
        throw invalidContract(
            "successful recovery requires consistent decoded output and strict validation",
        );
    }

    return {
        version: rawResult.version,
        engineVersion: rawResult.engineVersion,
        succeed: rawResult.succeed,
        method: rawResult.method,
        reason: rawResult.reason,
        videoRatio,
        audioRatio,
        stats,
    };
}

function parseRecoveryStats(rawStats) {
    if (!isPlainObject(rawStats)) {
        throw invalidContract("stats must be an object");
    }

    const stats = {};
    for (const field of RECOVERY_STAT_FIELDS) {
        const value = rawStats[field];
        if (!Number.isSafeInteger(value) || value < 0) {
            throw invalidContract(`stats.${field} must be a non-negative integer`);
        }
        stats[field] = value;
    }
    if (typeof rawStats.strictValidationPassed !== "boolean") {
        throw invalidContract("stats.strictValidationPassed must be a boolean");
    }
    if (stats.duplicatedVideoFrames > stats.outputVideoFrames) {
        throw invalidContract(
            "stats.duplicatedVideoFrames cannot exceed outputVideoFrames",
        );
    }
    if (stats.removedVideoFrames > stats.corruptVideoFrames) {
        throw invalidContract(
            "stats.removedVideoFrames cannot exceed corruptVideoFrames",
        );
    }
    if (stats.removedTimelineMs > stats.sourceDurationMs) {
        throw invalidContract(
            "stats.removedTimelineMs cannot exceed sourceDurationMs",
        );
    }
    if (stats.longestRemovedRunMs > stats.removedTimelineMs) {
        throw invalidContract(
            "stats.longestRemovedRunMs cannot exceed removedTimelineMs",
        );
    }
    if (stats.insertedAudioSilenceMs > stats.outputDurationMs) {
        throw invalidContract(
            "stats.insertedAudioSilenceMs cannot exceed outputDurationMs",
        );
    }
    stats.strictValidationPassed = rawStats.strictValidationPassed;
    stats.videoCorruptionPercent = calculatePercent(
        stats.corruptVideoFrames,
        stats.expectedVideoFrames,
    );
    stats.audioInsertedSilencePercent = calculatePercent(
        stats.insertedAudioSilenceMs,
        stats.outputDurationMs,
    );
    return stats;
}

function readOptionalRatio(value, fieldName) {
    if (value === null) return null;
    if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw invalidContract(`${fieldName} must be null or between 0 and 1`);
    }
    return value;
}

function calculatePercent(part, total) {
    if (total <= 0) return null;
    const percentage = (part / total) * 100;
    return Number.isFinite(percentage)
        ? Math.min(100, percentage)
        : null;
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

function normalizeMediaId(mediaId) {
    if (typeof mediaId !== "string" || !/^[a-f\d]{24}$/i.test(mediaId)) {
        throw new TypeError(
            "Media recovery requires a valid 24-character media ID",
        );
    }
    return mediaId.toLowerCase();
}

function isPlainObject(value) {
    return (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)
    );
}

function invalidContract(message) {
    return new MediaRecoveryOperationalError(
        `Native media recovery contract is invalid: ${message}`,
    );
}

function boundedDiagnostics(stderr) {
    const lines = String(stderr).split(/\r?\n/);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index].trim();
        if (line.startsWith("media-recovery:")) {
            return line.replace(/\s+/g, " ").slice(0, MESSAGE_LIMIT);
        }
    }

    return String(stderr)
        .replace(/\s+/g, " ")
        .trim()
        .slice(-MESSAGE_LIMIT);
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
