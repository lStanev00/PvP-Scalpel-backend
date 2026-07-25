import { enqueueMediaJob } from "../../../caching/charQueueCache/jobQueueCache.js";
import { jsonMessage, jsonResponse } from "../../../helpers/resposeHelpers.js";
import MediaMeta from "../../../Models/MediaMeta.js";

/**
 * Closes an integrity-described upload and enqueues it for processing.
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
export default async function finalizeMediaPATCH(req, res) {
    const rawMediaId = req.body?._id;
    const mediaId =
        typeof rawMediaId === "string" ? rawMediaId.trim().toLowerCase() : "";

    if (!/^[a-f\d]{24}$/.test(mediaId)) {
        return jsonMessage(res, 400, "A valid media ID is required");
    }

    let mediaDoc;
    let claimedForProcessing = false;
    let queueOwnsClaim = false;
    try {
        mediaDoc = await MediaMeta.findById(mediaId);
        if (!mediaDoc) {
            return jsonMessage(res, 404, "The media with this ID does not exist");
        }
        if (mediaDoc.state === "need_process" || mediaDoc.state === "processing") {
            return jsonResponse(res, 409, mediaDoc.toObject());
        }
        if (mediaDoc.state !== "await_data") {
            return jsonMessage(
                res,
                409,
                `Media upload is incomplete; current state is ${mediaDoc.state}`,
            );
        }

        const manifestError = validateCompleteManifest(mediaDoc.id, mediaDoc.manifest);
        if (manifestError) {
            return jsonMessage(res, 409, manifestError);
        }

        mediaDoc = await MediaMeta.findOneAndUpdate(
            {
                _id: mediaDoc._id,
                __v: mediaDoc.__v,
                state: "await_data",
            },
            {
                $set: { state: "need_process" },
                $inc: { __v: 1 },
            },
            {
                new: true,
                runValidators: true,
            },
        );
        if (!mediaDoc) {
            const current = await MediaMeta.findById(mediaId);
            return current
                ? jsonResponse(res, 409, current.toObject())
                : jsonMessage(res, 404, "The media with this ID does not exist");
        }
        claimedForProcessing = true;

        const job = await enqueueMediaJob(mediaDoc.id);
        if (job) {
            queueOwnsClaim = true;
            return jsonResponse(res, 201, mediaDoc.toObject());
        }
        if (job === 0) {
            queueOwnsClaim = true;
            return jsonResponse(res, 409, mediaDoc.toObject());
        }

        await releaseProcessingClaim(mediaDoc);
        claimedForProcessing = false;
        return jsonMessage(res, 500, "Failed to enqueue media processing");
    } catch (error) {
        if (claimedForProcessing && !queueOwnsClaim && mediaDoc) {
            await releaseProcessingClaim(mediaDoc).catch(() => {});
        }

        console.error(`[finalizeMediaPATCH][${mediaId}] failed`, error);
        return jsonMessage(res, 500, "Failed to finalize media upload");
    }
}

async function releaseProcessingClaim(mediaDoc) {
    const releaseResult = await MediaMeta.updateOne(
        {
            _id: mediaDoc._id,
            __v: mediaDoc.__v,
            state: "need_process",
        },
        {
            $set: { state: "await_data" },
            $inc: { __v: 1 },
        },
    );

    if (releaseResult.modifiedCount !== 1) {
        throw new Error("Failed to release the media processing claim");
    }
}

function validateCompleteManifest(mediaId, manifest) {
    const chunksNumber = manifest?.chunksNumber;
    const totalBytes = manifest?.totalBytes;
    const mediaParts = manifest?.mediaParts;
    const chunkSizes = manifest?.chunkSizes;
    const chunkSha256 = manifest?.chunkSha256;

    if (!Number.isSafeInteger(chunksNumber) || chunksNumber <= 0) {
        return "Media upload has no valid chunk count";
    }
    if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0) {
        return "Media upload has no valid total size";
    }
    if (
        !Array.isArray(mediaParts) ||
        !Array.isArray(chunkSizes) ||
        !Array.isArray(chunkSha256) ||
        mediaParts.length !== chunksNumber ||
        chunkSizes.length !== chunksNumber ||
        chunkSha256.length !== chunksNumber
    ) {
        return "Media upload is missing one or more parts";
    }

    let calculatedBytes = 0;
    for (let index = 0; index < chunksNumber; index += 1) {
        if (mediaParts[index] !== `videos/${mediaId}/part_${index}`) {
            return `Media upload part ${index} has an invalid object key`;
        }
        if (!Number.isSafeInteger(chunkSizes[index]) || chunkSizes[index] <= 0) {
            return `Media upload part ${index} has an invalid size`;
        }
        if (
            typeof chunkSha256[index] !== "string" ||
            !/^[a-f\d]{64}$/.test(chunkSha256[index])
        ) {
            return `Media upload part ${index} has an invalid SHA-256 digest`;
        }

        calculatedBytes += chunkSizes[index];
        if (!Number.isSafeInteger(calculatedBytes)) {
            return "Media upload size exceeds the supported range";
        }
    }

    return calculatedBytes === totalBytes
        ? null
        : "Media upload part sizes do not match the original file size";
}
