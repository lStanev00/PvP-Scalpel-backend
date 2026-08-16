import assert from "node:assert/strict";
import test from "node:test";
import {
    buildFrameExtractionArgs,
} from "../src/workers/jobQueue/jobWorkers/jobWorkerHelpers/processMedia/enqueueAIValidation.js";

test("moderation extraction guarantees a full-range JPEG for short videos", () => {
    const mediaPath =
        "/mnt/work/507f1f77bcf86cd799439011/source/media.mp4";
    const args = buildFrameExtractionArgs(mediaPath);
    const filter = args[args.indexOf("-vf") + 1];

    assert.equal(args[args.indexOf("-i") + 1], mediaPath);
    assert.equal(args[args.indexOf("-map") + 1], "0:v:0");
    assert.equal(args.includes("-an"), true);
    assert.equal(
        filter.includes(
            "select=eq(n\\,0)+gte(t-prev_selected_t\\,20)",
        ),
        true,
    );
    assert.match(filter, /out_range=full/);
    assert.match(filter, /format=yuvj420p/);
    assert.equal(args[args.indexOf("-pix_fmt") + 1], "yuvj420p");
    assert.equal(args[args.indexOf("-fps_mode") + 1], "vfr");
});
