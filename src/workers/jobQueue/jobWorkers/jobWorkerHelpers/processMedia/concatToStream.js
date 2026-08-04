import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
    access,
    lstat,
    mkdir,
    readdir,
    realpath,
    rm,
} from "node:fs/promises";
import path from "node:path";

const WORK_ROOT = "/mnt/work";
const STDERR_TAIL_LIMIT = 8 * 1024;
const INVALID_MEDIA_STREAM_PATTERN =
    /(?:invalid data found when processing input|invalid nal unit(?: size)?|error splitting the input into nal units|corrupt decoded frame|error submitting packet to decoder|error while decoding stream|decode_slice_header error|packet corrupt|channel element \d+\.\d+ is not allocated|input buffer exhausted before end element found|could not find codec parameters|output file does not contain any stream|nothing was written into output file)/i;
const FFMPEG_TIMEOUT_MS = readPositiveInteger(
    process.env.MEDIA_FFMPEG_TIMEOUT_MS,
    60 * 60 * 1000,
);

/**
 * Indicates that FFmpeg rejected the uploaded media stream itself.
 */
export class InvalidMediaStreamError extends Error {
    constructor(message) {
        super(message);
        this.name = "InvalidMediaStreamError";
    }
}

/**
 * Identifies FFmpeg diagnostics caused by invalid media bytes.
 *
 * @param {string} details
 * @returns {boolean}
 */
export function isInvalidMediaStreamFailure(details) {
    return INVALID_MEDIA_STREAM_PATTERN.test(details);
}

/**
 * @typedef {Object} HLSOutput
 * @property {string} outputDirectory Absolute directory containing the generated HLS files.
 * @property {string} playlistPath Absolute path to the generated `index.m3u8` playlist.
 * @property {string[]} segmentPaths Ordered absolute paths to the generated MPEG-TS segments.
 */

/**
 * Transcodes one complete reconstructed MP4 into a bitrate-limited H.264/AAC
 * HLS VOD rendition under the media job's private work directory.
 *
 * This helper only creates local output; uploading files and updating media
 * metadata are left to the caller.
 *
 * @param {string} mediaId Twenty-four character MongoDB ObjectId string.
 * @param {string} mediaPath Complete staged file or strictly validated recovery
 * output beneath this media job's isolated work directory.
 * @returns {Promise<HLSOutput>} Paths to the generated playlist and segments.
 * @throws {TypeError} When `mediaId` or `mediaPath` is invalid.
 * @throws {Error} When an input is unreadable, FFmpeg fails, or valid HLS output
 * is not produced.
 */
export default async function concatToStream(mediaId, mediaPath) {
    const normalizedMediaId = normalizeMediaId(mediaId);
    const workDirectory = path.posix.join(WORK_ROOT, normalizedMediaId); // local volume + id
    const outputDirectory = path.posix.join(workDirectory, "hls");
    const playlistPath = path.posix.join(outputDirectory, "index.m3u8");

    const inputPath = resolveMediaPath(normalizedMediaId, mediaPath);
    await verifyInputReadable(inputPath);

    await rm(outputDirectory, { recursive: true, force: true });
    await mkdir(outputDirectory, { recursive: true });

    await runFFmpeg(buildFFmpegArgs(inputPath, outputDirectory, playlistPath));

    const segmentPaths = await verifyHLSOutput(outputDirectory, playlistPath);

    return {
        outputDirectory,
        playlistPath,
        segmentPaths,
    };
}

function normalizeMediaId(mediaId) {
    if (typeof mediaId !== "string" || !/^[a-f\d]{24}$/i.test(mediaId)) {
        throw new TypeError("concatToStream requires a valid 24-character media ID");
    }

    return mediaId.toLowerCase();
}

function resolveMediaPath(mediaId, mediaPath) {
    const sourcePath = path.posix.join(
        WORK_ROOT,
        mediaId,
        "source",
        "media.mp4",
    );
    const recoveredPath = path.posix.join(
        WORK_ROOT,
        mediaId,
        "recovery",
        "recovered.mp4",
    );
    const structuralPath = path.posix.join(
        WORK_ROOT,
        mediaId,
        "recovery",
        "structural.mp4",
    );
    const ffmpegRecoveredPath = path.posix.join(
        WORK_ROOT,
        mediaId,
        "recovery",
        "ffmpeg-recovered.mp4",
    );
    if (
        mediaPath !== sourcePath &&
        mediaPath !== recoveredPath &&
        mediaPath !== structuralPath &&
        mediaPath !== ffmpegRecoveredPath
    ) {
        throw new TypeError(
            "Invalid complete media path for this isolated media job",
        );
    }

    return mediaPath;
}

async function verifyInputReadable(inputPath) {
    try {
        const [inputStats, resolvedPath] = await Promise.all([
            lstat(inputPath),
            realpath(inputPath),
            access(inputPath, fsConstants.R_OK),
        ]);
        if (
            !inputStats.isFile() ||
            inputStats.isSymbolicLink() ||
            resolvedPath !== inputPath
        ) {
            throw new Error("input is not a regular non-symlink file");
        }
    } catch (error) {
        throw new Error(`Complete media upload is not readable: ${inputPath}`, {
            cause: error,
        });
    }
}

function buildFFmpegArgs(inputPath, outputDirectory, playlistPath) {
    return [
        "-hide_banner",
        "-nostdin",
        "-y",
        "-i",
        inputPath,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-vf",
        "scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
        "-maxrate",
        "4000k",
        "-bufsize",
        "8000k",
        "-force_key_frames",
        "expr:gte(t,n_forced*6)",
        "-sc_threshold",
        "0",
        "-c:a",
        "aac",
        "-af",
        "aresample=async=1000:first_pts=0",
        "-b:a",
        "128k",
        "-ac",
        "2",
        "-f",
        "hls",
        "-hls_time",
        "6",
        "-hls_list_size",
        "0",
        "-hls_playlist_type",
        "vod",
        "-hls_flags",
        "independent_segments+temp_file",
        "-hls_segment_filename",
        path.posix.join(outputDirectory, "segment_%06d.ts"),
        playlistPath,
    ];
}

function runFFmpeg(args) {
    return new Promise((resolve, reject) => {
        let ffmpeg;
        let timedOut = false;
        try {
            ffmpeg = spawn("ffmpeg", args, {
                stdio: ["ignore", "ignore", "pipe"],
            });
        } catch (error) {
            reject(new Error(`Failed to start FFmpeg: ${error.message}`, { cause: error }));
            return;
        }

        const timeout = setTimeout(() => {
            timedOut = true;
            ffmpeg.kill("SIGKILL");
        }, FFMPEG_TIMEOUT_MS);
        let stderrTail = "";

        ffmpeg.stderr.setEncoding("utf8");
        ffmpeg.stderr.on("data", (data) => {
            stderrTail = `${stderrTail}${data}`.slice(-STDERR_TAIL_LIMIT);
        });

        ffmpeg.once("error", (error) => {
            clearTimeout(timeout);
            reject(new Error(`Failed to start FFmpeg: ${error.message}`, { cause: error }));
        });

        ffmpeg.once("close", (code, signal) => {
            clearTimeout(timeout);
            if (timedOut) {
                reject(new Error(`FFmpeg HLS conversion exceeded ${FFMPEG_TIMEOUT_MS}ms`));
                return;
            }
            if (code === 0) {
                resolve();
                return;
            }

            const exitReason = signal ? `signal ${signal}` : `code ${code}`;
            const details = stderrTail.trim();
            const message =
                `FFmpeg HLS conversion exited with ${exitReason}` +
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
        throw new TypeError("MEDIA_FFMPEG_TIMEOUT_MS must be a positive safe integer");
    }

    return parsed;
}

async function verifyHLSOutput(outputDirectory, playlistPath) {
    try {
        await access(playlistPath, fsConstants.R_OK);
    } catch (error) {
        throw new Error(`FFmpeg did not create a readable HLS playlist: ${playlistPath}`, {
            cause: error,
        });
    }

    const entries = await readdir(outputDirectory, { withFileTypes: true });
    const segmentPaths = entries
        .filter((entry) => entry.isFile() && /^segment_\d{6}\.ts$/.test(entry.name))
        .map((entry) => path.posix.join(outputDirectory, entry.name))
        .sort();

    if (segmentPaths.length === 0) {
        throw new Error(`FFmpeg did not create any HLS segments in ${outputDirectory}`);
    }

    for (const segmentPath of segmentPaths) {
        try {
            await access(segmentPath, fsConstants.R_OK);
        } catch (error) {
            throw new Error(`Generated HLS segment is not readable: ${segmentPath}`, {
                cause: error,
            });
        }
    }

    return segmentPaths;
}
