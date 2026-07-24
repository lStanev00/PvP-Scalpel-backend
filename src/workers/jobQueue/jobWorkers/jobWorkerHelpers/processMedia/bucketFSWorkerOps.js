import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";

const WORK_ROOT = "/mnt/work";

function resolveWorkPath(filePath) {
    if (typeof filePath !== "string") {
        throw new Error("local media path has to be a string");
    }

    const normalizedPath = path.posix.normalize(filePath);

    if (
        normalizedPath !== filePath ||
        !normalizedPath.startsWith(`${WORK_ROOT}/`) ||
        !/^\/mnt\/work\/[a-f\d]{24}\/source(?:\/(?:part_\d+|media\.mp4|thumbnail))?$/.test(
            normalizedPath,
        )
    ) {
        throw new Error(`Unsafe local media path: ${filePath}`);
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
 * Scans a locally staged media folder with the running ClamAV daemon.
 *
 * The scan accepts only `/mnt/work/<mediaId>/source`, which contains regular files
 * downloaded through the storage API. It never scans MinIO's backing volume.
 *
 * ClamAV exit codes are handled as:
 * 0: clean scan
 * 1: infected files found
 * 2 or other: scan/runtime error
 *
 * @param {string} path Absolute local source directory.
 * @returns {Promise<ClamAVScanResult>} Scan result.
 * @throws {Error} When clamdscan fails for a reason other than infected files.
 */
export async function scanFolder(path) {
    const execFileAsync = promisify(execFile);
    if (typeof path !== "string") {
        throw new TypeError("scanFolder requires a local source directory");
    }

    const folderPath = resolveWorkPath(path);
    const [folderStats, resolvedFolderPath] = await Promise.all([
        lstat(folderPath),
        realpath(folderPath),
    ]);
    if (
        !folderStats.isDirectory() ||
        folderStats.isSymbolicLink() ||
        resolvedFolderPath !== folderPath
    ) {
        throw new Error(`ClamAV source must be a regular local directory: ${folderPath}`);
    }

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
 * @param {string} filePath Absolute path to a staged local media part.
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
    const localPath = resolveWorkPath(filePath);
    const [fileStats, resolvedPath] = await Promise.all([
        lstat(localPath),
        realpath(localPath),
    ]);
    if (!fileStats.isFile() || fileStats.isSymbolicLink() || resolvedPath !== localPath) {
        throw new Error(`MIME source must be a regular local file: ${localPath}`);
    }

    const file = await open(
        localPath,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );

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
