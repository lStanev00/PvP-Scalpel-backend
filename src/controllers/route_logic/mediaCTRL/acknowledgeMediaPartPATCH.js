import { jsonMessage, jsonResponse } from "../../../helpers/resposeHelpers.js";
import MediaMeta from "../../../Models/MediaMeta.js";

/**
 * Records one successfully uploaded part in strict index order.
 *
 * The client acknowledgement is not treated as proof of object integrity. The
 * worker independently verifies the downloaded size and SHA-256 digest before
 * assembling the original file.
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
export default async function acknowledgeMediaPartPATCH(req, res) {
    const rawMediaId = req.body?._id;
    const mediaId =
        typeof rawMediaId === "string" ? rawMediaId.trim().toLowerCase() : "";
    const { index, size, sha256 } = req.body ?? {};

    if (!/^[a-f\d]{24}$/.test(mediaId)) {
        return jsonMessage(res, 400, "A valid media ID is required");
    }
    if (!Number.isSafeInteger(index) || index < 0) {
        return jsonMessage(res, 400, "A valid media part index is required");
    }
    if (!Number.isSafeInteger(size) || size <= 0) {
        return jsonMessage(res, 400, "A valid media part size is required");
    }
    if (typeof sha256 !== "string" || !/^[a-f\d]{64}$/.test(sha256)) {
        return jsonMessage(res, 400, "A valid media part SHA-256 digest is required");
    }

    try {
        const mediaDoc = await MediaMeta.findById(mediaId);
        if (!mediaDoc) {
            return jsonMessage(res, 404, "Media document was not found");
        }
        if (!["initializing", "uploading", "await_data"].includes(mediaDoc.state)) {
            return jsonMessage(
                res,
                409,
                `Media parts cannot be acknowledged while state is ${mediaDoc.state}`,
            );
        }

        const manifest = mediaDoc.manifest;
        const chunksNumber = manifest?.chunksNumber;
        const expectedSizes = manifest?.chunkSizes;
        const expectedHashes = manifest?.chunkSha256;

        if (
            !Number.isSafeInteger(chunksNumber) ||
            !Array.isArray(expectedSizes) ||
            !Array.isArray(expectedHashes) ||
            expectedSizes.length !== chunksNumber ||
            expectedHashes.length !== chunksNumber
        ) {
            return jsonMessage(res, 409, "Media upload manifest is incomplete");
        }
        if (index >= chunksNumber) {
            return jsonMessage(res, 400, "Media part index exceeds the upload manifest");
        }
        if (expectedSizes[index] !== size || expectedHashes[index] !== sha256) {
            return jsonMessage(res, 409, "Media part does not match its upload manifest");
        }

        if (!Array.isArray(manifest.mediaParts)) {
            manifest.mediaParts = [];
        }

        const keyId = `videos/${mediaId}/part_${index}`;
        const acknowledgedCount = manifest.mediaParts.length;

        if (index < acknowledgedCount) {
            if (manifest.mediaParts[index] !== keyId) {
                return jsonMessage(res, 409, "Media part acknowledgement conflicts");
            }

            return jsonResponse(res, 200, {
                mediaObj: mediaDoc.toObject(),
                acknowledged: { index, keyId },
            });
        }
        if (index !== acknowledgedCount) {
            return jsonMessage(res, 409, "Media parts must be acknowledged in order");
        }

        const nextState =
            acknowledgedCount + 1 === chunksNumber ? "await_data" : "uploading";
        const saved = await MediaMeta.findOneAndUpdate(
            {
                _id: mediaDoc._id,
                __v: mediaDoc.__v,
                state: mediaDoc.state,
            },
            {
                $push: { "manifest.mediaParts": keyId },
                $set: { state: nextState },
                $inc: { __v: 1 },
            },
            {
                new: true,
                runValidators: true,
            },
        );

        if (!saved) {
            const current = await MediaMeta.findById(mediaId);
            if (current?.manifest?.mediaParts?.[index] === keyId) {
                return jsonResponse(res, 200, {
                    mediaObj: current.toObject(),
                    acknowledged: { index, keyId },
                });
            }

            return jsonMessage(
                res,
                409,
                "Media upload changed while acknowledging this part; retry the request",
            );
        }

        return jsonResponse(res, 200, {
            mediaObj: saved.toObject(),
            acknowledged: { index, keyId },
        });
    } catch (error) {
        console.error(
            `[acknowledgeMediaPartPATCH][${mediaId}] failed to acknowledge part ${index}`,
            error,
        );
        return jsonMessage(res, 500, "Failed to acknowledge media part");
    }
}
