/*/
    This is the formating checking for thew media uploaded by an user
    this proccess involves stages:
        0. Download exact quarantine objects into an isolated local work folder.
        1. Scan the locally staged upload folder for malware.
        2. Validate every staged part by its detected MIME signature.
        3. Moderate every staged part with the local AI validation service.
        4. Concatenate approved parts and export the media as an HLS stream.
        5. Publish the HLS output and thumbnail to public object storage.
        6. Delete the quarantine sources after the media is persisted as done.

    The proccess itself is not time sensitive and is optimised for workflow completion roughtly estimates work to
    6-20 minutes based on the server setup and proccessing power of the hardware as described in docs\server-resources.md
/*/
import { detectMimeFromFile, scanFolder } from "./processMedia/bucketFSWorkerOps.js";
import MediaMeta from "../../../../Models/MediaMeta.js";
import enqueueAIValidation from "./processMedia/enqueueAIValidation.js";
import concatToStream from "./processMedia/concatToStream.js";
import stageMediaLocally, {
    cleanupLocalMedia,
} from "./processMedia/stageMediaLocally.js";
import commitMediaToPublic, {
    deleteQuarantineMedia,
} from "./commitMediaToPublic.js";

/**
 * @typedef {"processed"|"quarantined"|"censored"|"invalid_job"|"not_found"|"invalid_state"|"failed"} ProcessMediaOutcome
 */

/**
 * @typedef {object} ProcessMediaResult
 * @property {string|null} _id Normalized media ID, or `null` when the job has no usable ID.
 * @property {boolean} succeed Whether the job reached an expected terminal outcome.
 * @property {200|400|404|409|500} status Worker completion status.
 * @property {ProcessMediaOutcome} outcome Machine-readable processing outcome.
 * @property {string} [message] Failure description; omitted for successful outcomes.
 * @property {string} [stack] Original error stack for unexpected processing failures.
 */

/**
 * Processes one queued media document and always returns a completion result.
 *
 * Processing stages:
 * 0. Download exact quarantine objects into an isolated local work folder.
 * 1. Scan the locally staged upload folder for malware.
 * 2. Validate every staged part by its detected MIME signature.
 * 3. Moderate every staged part with the local AI validation service.
 * 4. Concatenate approved parts and export the media as an HLS stream.
 * 5. Publish the HLS output and thumbnail to public object storage.
 * 6. Delete the quarantine sources after the media is persisted as done.
 *
 * Return values:
 * - `200 / processed`: approved media was exported and marked done.
 * - `200 / quarantined`: malware or an unsupported MIME signature was handled.
 * - `200 / censored`: AI moderation rejected the media and processing stopped.
 * - `400 / invalid_job`: the job type or media ID is invalid.
 * - `404 / not_found`: no media document exists for the supplied ID.
 * - `409 / invalid_state`: the document is not ready for initial processing.
 * - `500 / failed`: an unexpected processing or persistence operation failed.
 *
 * @param {{type?: string, data?: {_id?: string}}} job
 * @returns {Promise<ProcessMediaResult>} Non-throwing completion result sent back to the parent worker.
 */
export default async function processMedia(job) {
    const rawMediaId = job?.data?._id;
    const mediaId = typeof rawMediaId === "string" ? rawMediaId.trim().toLowerCase() : "";
    let workDoc;
    let claimedProcessing = false;
    let localMediaStaged = false;

    if (job?.type !== "processMedia" || !/^[a-f\d]{24}$/.test(mediaId)) {
        return failureResult(
            mediaId || null,
            400,
            "invalid_job",
            "processMedia job requires type processMedia and a valid 24-character data._id",
        );
    }

    try {
        workDoc = await MediaMeta.findById(mediaId); // retrive the document
        if (!workDoc) {
            // not found in dbase 404
            return failureResult(mediaId, 404, "not_found", "Media document was not found");
        }
        if (workDoc.state !== "need_process") {
            // this module is for inital proccessin by date: 24.7/26 is subject to change
            // for now will remain as is and will throw if the document is not with state listed on the in block
            return failureResult(
                mediaId,
                409,
                "invalid_state",
                `Media state must be need_process, received ${workDoc.state}`,
            );
        }

        const mediaParts = workDoc.manifest?.mediaParts; // check for existing parts
        if (!Array.isArray(mediaParts) || mediaParts.length === 0) {
            // if there is no parts the proccessing can't continue and has to throw an err
            throw new Error("Media document has no manifest media parts");
        }

        workDoc.state = "processing"; // change the state to proccessing then save it
        await workDoc.save();
        claimedProcessing = true;

        const quarantineThumbnailKey = workDoc.manifest?.thumbnail;
        const stagedMedia = await stageMediaLocally(
            workDoc.id,
            mediaParts,
            quarantineThumbnailKey,
        );
        localMediaStaged = true;

        // Stage 1: scan the complete locally staged upload for malware.
        const malwareScan = await scanFolder(stagedMedia.sourceDirectory);
        if (malwareScan?.infected) {
            workDoc.quarantined = true;
            await cleanupLocalMedia(mediaId);
            localMediaStaged = false;
            await finishProcessing(workDoc);
            claimedProcessing = false;
            return successResult(mediaId, "quarantined");
        }
        if (!malwareScan?.clean) {
            throw new Error("Malware scanner returned an invalid result");
        }

        // Stage 2: reject parts whose file signature is not a supported media MIME type.
        for (const localPartPath of stagedMedia.mediaPartPaths) {
            const mimeFormat = await detectMimeFromFile(localPartPath);
            if (mimeFormat.startsWith("application/octet-stream")) {
                workDoc.quarantined = true;
                await cleanupLocalMedia(mediaId);
                localMediaStaged = false;
                await finishProcessing(workDoc);
                claimedProcessing = false;
                return successResult(mediaId, "quarantined");
            }
        }

        // Stage 3: moderate the uploaded media content with the local AI service.
        for (const localPartPath of stagedMedia.mediaPartPaths) {
            const validation = await enqueueAIValidation(localPartPath);
            if (validation.decision === "allow") continue; // continue if there's no forbidden content otherwse censor it and finish the job

            workDoc.censored = true;
            await cleanupLocalMedia(mediaId);
            localMediaStaged = false;
            await finishProcessing(workDoc);
            claimedProcessing = false;
            return successResult(mediaId, "censored");
        }

        // Stage 4: concatenate approved parts and render the streamable HLS output.
        const concatData = await concatToStream(
            workDoc.id,
            stagedMedia.mediaPartPaths,
        );

        // Stage 5: publish only generated HLS files and the staged thumbnail.
        const publicMedia = await commitMediaToPublic(
            workDoc.id,
            concatData,
            stagedMedia.thumbnailPath,
        );
        localMediaStaged = false;
        workDoc.manifest.playlist = publicMedia.playlistKey;
        workDoc.manifest.thumbnail = publicMedia.thumbnailKey;

        await finishProcessing(workDoc);
        claimedProcessing = false;

        // Stage 6: remove exact quarantine sources only after state `done` is persisted.
        try {
            const cleanup = await deleteQuarantineMedia(
                workDoc.id,
                mediaParts,
                quarantineThumbnailKey,
                workDoc.state,
            );

            if (cleanup.failedKeys.length > 0) {
                console.warn(
                    `[processMedia][${mediaId}] public media is ready; quarantine cleanup failed for ${cleanup.failedKeys.length} objects`,
                );
            } else {
                workDoc.manifest.mediaParts = [];
                await workDoc.save();
            }
        } catch (cleanupError) {
            const cleanupMessage =
                cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
            console.warn(
                `[processMedia][${mediaId}] public media is ready; quarantine cleanup failed: ${cleanupMessage}`,
            );
        }

        return successResult(mediaId, "processed");
    } catch (error) {
        // the proccessing genuinly threw error and need investigating
        const handledError = error instanceof Error ? error : new Error(String(error));
        let message = handledError.message;

        if (localMediaStaged) {
            try {
                await cleanupLocalMedia(mediaId);
                localMediaStaged = false;
            } catch (cleanupError) {
                const cleanupMessage =
                    cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
                message += `; failed to clean local media staging: ${cleanupMessage}`;
            }
        }

        if (claimedProcessing && workDoc) {
            try {
                workDoc.state = "need_process";
                await workDoc.save();
            } catch (recoveryError) {
                const recoveryMessage =
                    recoveryError instanceof Error ? recoveryError.message : String(recoveryError);
                message += `; failed to reset media state: ${recoveryMessage}`;
            }
        }

        return failureResult(mediaId, 500, "failed", message, handledError.stack);
    }
}

/**
 * Marks a media document as finished and persists it.
 *
 * @param {{state: string, save: () => Promise<unknown>}} workDoc
 * @returns {Promise<unknown>} Saved media document returned by the model.
 */
async function finishProcessing(workDoc) {
    workDoc.state = "done";
    return await workDoc.save();
}

/**
 * Creates a successful media-worker completion result.
 *
 * @param {string} _id
 * @param {"processed"|"quarantined"|"censored"} outcome
 * @returns {ProcessMediaResult} Successful result with status `200`.
 */
function successResult(_id, outcome) {
    return {
        _id,
        succeed: true,
        status: 200,
        outcome,
    };
}

/**
 * Creates a failed media-worker completion result.
 *
 * @param {string|null} _id
 * @param {400|404|409|500} status
 * @param {"invalid_job"|"not_found"|"invalid_state"|"failed"} outcome
 * @param {string} message
 * @param {string} [stack]
 * @returns {ProcessMediaResult} Failed result containing diagnostic details.
 */
function failureResult(_id, status, outcome, message, stack) {
    return {
        _id,
        succeed: false,
        status,
        outcome,
        message,
        ...(typeof stack === "string" ? { stack } : {}),
    };
}
