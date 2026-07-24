import { constants as fsConstants } from "node:fs";
import { lstat, open, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";

const WORK_ROOT = "/mnt/work";
const COPY_BUFFER_BYTES = 1024 * 1024;

/**
 * Reassembles ordered upload byte chunks into one complete local MP4.
 *
 * Inputs and output are restricted to the media job's private work directory.
 * Files are opened without following symlinks, and the partial output is renamed
 * only after every input byte has been copied successfully.
 *
 * @param {string} mediaId Twenty-four character MongoDB ObjectId string.
 * @param {string[]} mediaPartPaths Exact ordered `part_<index>` paths.
 * @returns {Promise<string>} Exact `/mnt/work/<mediaId>/source/media.mp4` path.
 */
export default async function assembleMediaParts(mediaId, mediaPartPaths) {
    const normalizedMediaId = normalizeMediaId(mediaId);
    const sourceDirectory = path.posix.join(WORK_ROOT, normalizedMediaId, "source");
    const inputPaths = validateMediaPartPaths(
        sourceDirectory,
        mediaPartPaths,
    );
    const outputPath = path.posix.join(sourceDirectory, "media.mp4");
    const partialPath = `${outputPath}.partial`;

    await rm(partialPath, { force: true });
    await rm(outputPath, { force: true });

    let outputHandle;
    try {
        outputHandle = await open(
            partialPath,
            fsConstants.O_WRONLY |
                fsConstants.O_CREAT |
                fsConstants.O_EXCL |
                fsConstants.O_NOFOLLOW,
            0o600,
        );

        const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
        for (const inputPath of inputPaths) {
            await appendRegularFile(inputPath, outputHandle, buffer);
        }

        await outputHandle.sync();
        await outputHandle.close();
        outputHandle = undefined;

        await rename(partialPath, outputPath);
        await assertRegularFile(outputPath);
        return outputPath;
    } catch (error) {
        await outputHandle?.close().catch(() => {});
        await rm(partialPath, { force: true }).catch(() => {});
        await rm(outputPath, { force: true }).catch(() => {});
        throw new Error(`Failed to assemble local media upload: ${error.message}`, {
            cause: error,
        });
    }
}

function normalizeMediaId(mediaId) {
    if (typeof mediaId !== "string" || !/^[a-f\d]{24}$/i.test(mediaId)) {
        throw new TypeError("Media assembly requires a valid 24-character media ID");
    }

    return mediaId.toLowerCase();
}

function validateMediaPartPaths(sourceDirectory, mediaPartPaths) {
    if (!Array.isArray(mediaPartPaths) || mediaPartPaths.length === 0) {
        throw new TypeError("Media assembly requires ordered local media parts");
    }

    return mediaPartPaths.map((mediaPartPath, index) => {
        const expectedPath = path.posix.join(sourceDirectory, `part_${index}`);
        if (mediaPartPath !== expectedPath) {
            throw new TypeError(
                `Unexpected local media part at index ${index}: ${mediaPartPath}`,
            );
        }
        return expectedPath;
    });
}

async function appendRegularFile(inputPath, outputHandle, buffer) {
    await assertRegularFile(inputPath);
    const inputHandle = await open(
        inputPath,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );

    try {
        const inputStats = await inputHandle.stat();
        if (!inputStats.isFile()) {
            throw new Error(`Media assembly input is not a regular file: ${inputPath}`);
        }

        let inputPosition = 0;
        while (inputPosition < inputStats.size) {
            const bytesToRead = Math.min(
                buffer.length,
                inputStats.size - inputPosition,
            );
            const { bytesRead } = await inputHandle.read(
                buffer,
                0,
                bytesToRead,
                inputPosition,
            );
            if (bytesRead === 0) {
                throw new Error(`Media assembly input ended early: ${inputPath}`);
            }

            let written = 0;
            while (written < bytesRead) {
                const result = await outputHandle.write(
                    buffer,
                    written,
                    bytesRead - written,
                );
                if (result.bytesWritten === 0) {
                    throw new Error("Media assembly output stopped accepting bytes");
                }
                written += result.bytesWritten;
            }

            inputPosition += bytesRead;
        }
    } finally {
        await inputHandle.close();
    }
}

async function assertRegularFile(filePath) {
    const [stats, resolvedPath] = await Promise.all([
        lstat(filePath),
        realpath(filePath),
    ]);
    if (!stats.isFile() || stats.isSymbolicLink() || resolvedPath !== filePath) {
        throw new Error(
            `Media assembly source must be a regular non-symlink file: ${filePath}`,
        );
    }
}
