import { promisify } from "node:util";
import { execFile } from "node:child_process";

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
export default async function scanFolder(path) {
    const execFileAsync = promisify(execFile);
    if (typeof path !== "string") {
        return console.warn("path has to be a string at scanFolder");
    }

    const folderPath = "/mnt/s3-bucket" + path;
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
