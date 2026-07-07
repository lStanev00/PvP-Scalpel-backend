import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { open } from "node:fs/promises";
import path from "node:path";

const BUCKET_ROOT = "/mnt/s3-bucket";

function resolveBucketPath(filePath) {
    if (typeof filePath !== "string") {
        throw new Error("bucket path has to be a string");
    }

    if (filePath === BUCKET_ROOT || filePath.startsWith(`${BUCKET_ROOT}/`)) {
        return filePath;
    }

    const normalizedPath = path.posix.normalize(`${BUCKET_ROOT}/${filePath.replace(/^\/+/, "")}`);

    if (normalizedPath !== BUCKET_ROOT && !normalizedPath.startsWith(`${BUCKET_ROOT}/`)) {
        throw new Error(`bucket path escapes ${BUCKET_ROOT}: ${filePath}`);
    }

    return normalizedPath;
}

/**
 * @typedef {Object} ClamAVScanResult
 * @property {boolean} clean True when ClamAV completed the scan without finding infected files.
 * @property {boolean} infected True when ClamAV found at least one infected file.
 * @property {string} output Raw stdout from clamdscan. With --infected this only lists infected files plus the summary.
 */

/**
 * Scans a folder inside the mounted MinIO bucket volume with the running ClamAV daemon.
 *
 * The provided path is appended to `/mnt/s3-bucket`, so pass bucket-relative paths
 * such as `"/quarantine-uploads"` rather than an absolute host path. The scan uses
 * `clamdscan`, which expects `clamd` to already be running in the worker container.
 *
 * ClamAV exit codes are handled as:
 * 0: clean scan
 * 1: infected files found
 * 2 or other: scan/runtime error
 *
 * @param {string} path Folder path relative to `/mnt/s3-bucket`.
 * @returns {Promise<ClamAVScanResult|void>} Scan result, or void when `path` is not a string.
 * @throws {Error} When clamdscan fails for a reason other than infected files.
 */
export async function scanFolder(path) {
    const execFileAsync = promisify(execFile);
    if (typeof path !== "string") {
        return console.warn("path has to be a string at scanFolder");
    }

    const folderPath = resolveBucketPath(path);
    try {
        const { stdout } = await execFileAsync(
            "clamdscan",
            [
                "--fdpass",
                "--config-file",
                "/etc/clamav/clamd.conf",
                "--multiscan",
                "--infected",
                folderPath,
            ],
            {
                timeout: 30 * 60 * 1000,
                maxBuffer: 10 * 1024 * 1024,
            },
        );

        return {
            clean: true,
            infected: false,
            output: stdout,
        };
    } catch (error) {
        if (error.code === 1) {
            return {
                clean: false,
                infected: true,
                output: error.stdout || "",
            };
        }

        throw new Error(`ClamAV folder scan failed: ${error.stderr || error.message}`);
    }
}


/**
 * Detects a file's video MIME type from its leading magic bytes.
 *
 * This helper reads only the first 4100 bytes, so detection cost is fixed and
 * does not scale with large upload chunk size. It does not execute the file,
 * parse the full media container, or trust the filename/extension.
 *
 * Supported signatures:
 * - `video/mp4` when the MP4 `ftyp` box appears at offset 4.
 * - `video/webm` when the EBML header is present.
 * - `video/ogg` when the Ogg page header is present.
 *
 * @param {string} filePath Absolute path or bucket-relative path to a readable file inside the worker container.
 * @returns {Promise<"video/mp4" | "video/webm" | "video/ogg" | "application/octet-stream">}
 * Detected MIME type, or `application/octet-stream` when the signature is not recognized.
 * @throws {Error} When `filePath` is invalid, cannot be opened, or cannot be read.
 */
export async function detectMimeFromFile(filePath) {
    const VIDEO_SIGNATURES = [
        {
            mime: "video/mp4",
            test: (buf) => buf.length >= 12 && buf.toString("ascii", 4, 8) === "ftyp",
        },
        {
            mime: "video/webm",
            test: (buf) => buf.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])),
        },
        {
            mime: "video/ogg",
            test: (buf) => buf.subarray(0, 4).toString("ascii") === "OggS",
        },
    ];
    const file = await open(resolveBucketPath(filePath), "r");

    try {
        const buffer = Buffer.alloc(4100);
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
        const head = buffer.subarray(0, bytesRead);

        for (const signature of VIDEO_SIGNATURES) {
            if (signature.test(head)) return signature.mime;
        }

        return "application/octet-stream";
    } finally {
        await file.close();
    }
}
