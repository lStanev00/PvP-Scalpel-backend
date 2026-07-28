import assert from "node:assert/strict";
import test from "node:test";
import {
    isInvalidMediaStreamFailure,
} from "../src/workers/jobQueue/jobWorkers/jobWorkerHelpers/processMedia/concatToStream.js";
import salvageCorruptMedia, {
    buildFFmpegSalvageArgs,
} from "../src/workers/jobQueue/jobWorkers/jobWorkerHelpers/processMedia/salvageCorruptMedia.js";

const MEDIA_ID = "6a645e4f44d315ad5c30e605";
const INPUT = `/mnt/work/${MEDIA_ID}/source/media.mp4`;
const OUTPUT = `/mnt/work/${MEDIA_ID}/recovery/ffmpeg-recovered.mp4`;

test("builds the fixed tolerant FFmpeg salvage command", () => {
    assert.deepEqual(buildFFmpegSalvageArgs(INPUT, OUTPUT), [
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
        INPUT,
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
        OUTPUT,
    ]);
});

test("classifies corrupt stream diagnostics without treating infrastructure as media", () => {
    assert.equal(
        isInvalidMediaStreamFailure(
            "Invalid NAL unit size. Error splitting the input into NAL units.",
        ),
        true,
    );
    assert.equal(
        isInvalidMediaStreamFailure("No space left on device"),
        false,
    );
});

test("rejects invalid IDs before touching the filesystem", async () => {
    await assert.rejects(
        salvageCorruptMedia("invalid", INPUT),
        /valid 24-character media ID/,
    );
});

test("rejects a source path outside the isolated media job", async () => {
    await assert.rejects(
        salvageCorruptMedia(MEDIA_ID, "/tmp/broken.mp4"),
        /exact isolated source-media path/,
    );
});
