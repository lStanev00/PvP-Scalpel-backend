import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, readdir, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const BUCKET_ROOT = "/mnt/s3-bucket";
const QUARANTINE_ROOT = path.posix.join(BUCKET_ROOT, "quarantine-uploads");
const WORK_ROOT = "/mnt/work";
const STDERR_TAIL_LIMIT = 8 * 1024;

/**
 * @typedef {Object} HLSOutput
 * @property {string} outputDirectory Absolute directory containing the generated HLS files.
 * @property {string} playlistPath Absolute path to the generated `index.m3u8` playlist.
 * @property {string[]} segmentPaths Ordered absolute paths to the generated MPEG-TS segments.
 */

/**
 * Concatenates ordered, independently playable MP4 parts and transcodes them into
 * one H.264/AAC HLS VOD rendition under `/tmp`.
 *
 * Every input must use a compatible stream layout and recording configuration so
 * FFmpeg's concat demuxer can read the files as one sequence. This helper only
 * creates local output; uploading files and updating media metadata are left to
 * the caller.
 *
 * @param {string} mediaId Twenty-four character MongoDB ObjectId string.
 * @param {string[]} mediaParts Ordered bucket-relative paths in the exact form
 * `videos/<mediaId>/part_<index>`.
 * @returns {Promise<HLSOutput>} Paths to the generated playlist and segments.
 * @throws {TypeError} When `mediaId` or `mediaParts` is invalid.
 * @throws {Error} When an input is unreadable, FFmpeg fails, or valid HLS output
 * is not produced.
 */
export default async function concatToStream(mediaId, mediaParts) {
    const normalizedMediaId = normalizeMediaId(mediaId);
    const workDirectory = path.posix.join(WORK_ROOT, normalizedMediaId); // local volume + id
    const outputDirectory = path.posix.join(workDirectory, "hls");
    const concatListPath = path.posix.join(workDirectory, "parts.ffconcat");
    const playlistPath = path.posix.join(outputDirectory, "index.m3u8");

    try {
        const inputPaths = resolveMediaParts(normalizedMediaId, mediaParts);
        await verifyInputsReadable(inputPaths);

        await rm(workDirectory, { recursive: true, force: true });
        await mkdir(outputDirectory, { recursive: true });
        await writeFile(concatListPath, buildConcatList(inputPaths), {
            encoding: "utf8",
            flag: "wx",
        });

        await runFFmpeg(buildFFmpegArgs(concatListPath, outputDirectory, playlistPath));

        const segmentPaths = await verifyHLSOutput(outputDirectory, playlistPath);
        await unlink(concatListPath);

        return {
            outputDirectory,
            playlistPath,
            segmentPaths,
        };
    } catch (error) {
        await rm(workDirectory, { recursive: true, force: true }).catch(() => {});
        throw error;
    }
}

function normalizeMediaId(mediaId) {
    if (typeof mediaId !== "string" || !/^[a-f\d]{24}$/i.test(mediaId)) {
        throw new TypeError("concatToStream requires a valid 24-character media ID");
    }

    return mediaId.toLowerCase();
}

function resolveMediaParts(mediaId, mediaParts) {
    if (!Array.isArray(mediaParts) || mediaParts.length === 0) {
        throw new TypeError("concatToStream requires at least one ordered media part");
    }

    const resolvedParts = [];
    for (let index = 0; index < mediaParts.length; index++) {
        const expectedPath = `videos/${mediaId}/part_${index}`;
        if (mediaParts[index] !== expectedPath) {
            throw new TypeError(
                `Invalid media part at index ${index}; expected "${expectedPath}"`,
            );
        }

        resolvedParts.push(path.posix.join(QUARANTINE_ROOT, expectedPath));
    }

    return resolvedParts;
}

async function verifyInputsReadable(inputPaths) {
    for (const inputPath of inputPaths) {
        try {
            await access(inputPath, fsConstants.R_OK);
        } catch (error) {
            throw new Error(`Media part is not readable: ${inputPath}`, { cause: error });
        }
    }
}

function buildConcatList(inputPaths) {
    return `ffconcat version 1.0\n${inputPaths
        .map((inputPath) => `file '${inputPath}'`)
        .join("\n")}\n`;
}

function buildFFmpegArgs(concatListPath, outputDirectory, playlistPath) {
    return [
        "-hide_banner",
        "-nostdin",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        concatListPath,
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
        "-force_key_frames",
        "expr:gte(t,n_forced*6)",
        "-sc_threshold",
        "0",
        "-c:a",
        "aac",
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
        try {
            ffmpeg = spawn("ffmpeg", args, {
                stdio: ["ignore", "ignore", "pipe"],
            });
        } catch (error) {
            reject(new Error(`Failed to start FFmpeg: ${error.message}`, { cause: error }));
            return;
        }

        let stderrTail = "";

        ffmpeg.stderr.setEncoding("utf8");
        ffmpeg.stderr.on("data", (data) => {
            stderrTail = `${stderrTail}${data}`.slice(-STDERR_TAIL_LIMIT);
        });

        ffmpeg.once("error", (error) => {
            reject(new Error(`Failed to start FFmpeg: ${error.message}`, { cause: error }));
        });

        ffmpeg.once("close", (code, signal) => {
            if (code === 0) {
                resolve();
                return;
            }

            const exitReason = signal ? `signal ${signal}` : `code ${code}`;
            const details = stderrTail.trim();
            reject(
                new Error(
                    `FFmpeg HLS conversion exited with ${exitReason}` +
                        `${details ? `: ${details}` : ""}`,
                ),
            );
        });
    });
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
