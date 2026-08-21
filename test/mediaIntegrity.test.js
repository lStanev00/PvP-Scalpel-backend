import assert from "node:assert/strict";
import test from "node:test";
import {
    publicVideoFormat,
} from "../src/workers/jobQueue/jobWorkers/jobWorkerHelpers/commitMediaToPublic.js";
import validateMediaIntegrity, {
    buildFFmpegValidationArgs,
} from "../src/workers/jobQueue/jobWorkers/jobWorkerHelpers/processMedia/validateMediaIntegrity.js";

const MEDIA_ID = "6a645e4f44d315ad5c30e605";
const SOURCE = `/mnt/work/${MEDIA_ID}/source/media.mp4`;

test("builds a strict full-stream decode with no media output", () => {
    const args = buildFFmpegValidationArgs(SOURCE);
    assert.deepEqual(args, [
        "-hide_banner",
        "-nostdin",
        "-v",
        "error",
        "-xerror",
        "-err_detect",
        "explode",
        "-i",
        SOURCE,
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
    ]);
    assert.equal(args.includes("libx264"), false);
    assert.equal(args.includes("hls"), false);
});

test("maps detected video MIME types to deterministic public extensions", () => {
    assert.deepEqual(publicVideoFormat("video/mp4"), {
        extension: ".mp4",
        mimeType: "video/mp4",
    });
    assert.deepEqual(publicVideoFormat("video/webm"), {
        extension: ".webm",
        mimeType: "video/webm",
    });
    assert.deepEqual(publicVideoFormat("video/ogg"), {
        extension: ".ogv",
        mimeType: "video/ogg",
    });
    assert.throws(
        () => publicVideoFormat("video/quicktime"),
        /Unsupported public video MIME type/,
    );
});

test("rejects invalid IDs and paths before starting FFmpeg", async () => {
    await assert.rejects(
        validateMediaIntegrity("invalid", SOURCE),
        /valid 24-character media ID/,
    );
    await assert.rejects(
        validateMediaIntegrity(MEDIA_ID, "/tmp/media.mp4"),
        /Unexpected media integrity validation path/,
    );
});
