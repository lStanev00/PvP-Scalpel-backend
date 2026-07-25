/*/
    This is the formating checking for thew media uploaded by an user
    this proccess involves stages:
        0. Download exact quarantine objects into an isolated local work folder.
        1. Reassemble and scan the upload, unless a recovery fingerprint already passed.
        2. Validate the complete upload's MIME signature.
        3. Moderate the complete upload with the local AI validation service.
        4. Generate a random thumbnail from the complete upload when none was uploaded.
        5. Export the approved upload as HLS, recovering corrupt MP4 streams when possible.
        6. Publish the HLS output and thumbnail to public object storage.
        7. Delete the quarantine sources after the media is persisted as done.

    The proccess itself is not time sensitive and is optimised for workflow completion roughtly estimates work to
    6-20 minutes based on the server setup and proccessing power of the hardware as described in docs\server-resources.md
/*/
import { createHash } from "node:crypto";
import { detectMimeFromFile, scanFolder } from "./processMedia/bucketFSWorkerOps.js";
import MediaMeta from "../../../../Models/MediaMeta.js";
import enqueueAIValidation from "./processMedia/enqueueAIValidation.js";
import concatToStream, {
    InvalidMediaStreamError,
} from "./processMedia/concatToStream.js";
import stageMediaLocally, {
    cleanupLocalMedia,
} from "./processMedia/stageMediaLocally.js";
import generateMediaThumbnail from "./processMedia/generateMediaThumbnail.js";
import assembleMediaParts from "./processMedia/assembleMediaParts.js";
import recoverCorruptMedia from "./processMedia/recoverCorruptMedia.js";
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
 * @property {string} [reason] Machine-readable reason for an expected safety outcome.
 * @property {string} [message] Failure description; omitted for successful outcomes.
 * @property {string} [stack] Original error stack for unexpected processing failures.
 */

/**
 * Processes one queued media document and always returns a completion result.
 *
 * Processing stages:
 * 0. Download exact quarantine objects into an isolated local work folder.
 * 1. Reassemble and scan the upload, unless a recovery fingerprint already passed.
 * 2. Validate the complete upload's MIME signature.
 * 3. Moderate the complete upload with the local AI validation service.
 * 4. Generate a random thumbnail from the complete upload when none was uploaded.
 * 5. Export the approved upload as HLS, recovering corrupt MP4 streams when possible.
 * 6. Publish the HLS output and thumbnail to public object storage.
 * 7. Delete the quarantine sources after the media is persisted as done.
 *
 * Return values:
 * - `200 / processed`: approved media was exported and marked done.
 * - `200 / quarantined`: malware or an unsupported MIME was handled.
 * - `200 / censored`: AI moderation rejected the media and processing stopped.
 * - `400 / invalid_job`: the job type or media ID is invalid.
 * - `404 / not_found`: no media document exists for the supplied ID.
 * - `409 / invalid_state`: the document is neither pending nor a quarantined retry.
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
        const isQuarantinedRetry =
            workDoc.state === "done" && workDoc.quarantined === true;
        if (workDoc.state !== "need_process" && !isQuarantinedRetry) {
            // this module is for inital proccessin by date: 24.7/26 is subject to change
            // for now will remain as is and will throw if the document is not with state listed on the in block
            return failureResult(
                mediaId,
                409,
                "invalid_state",
                `Media must be need_process or done and quarantined, received state=${workDoc.state} quarantined=${workDoc.quarantined}`,
            );
        }
        if (isQuarantinedRetry) {
            console.info(
                `[processMedia][${mediaId}][state] reopening done quarantined media for processing`,
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
        const sourceFingerprint = buildRecoverySourceFingerprint(workDoc.manifest);
        const recoveryRetry = isMatchingRecoveryRetry(
            workDoc.manifest?.recovery,
            sourceFingerprint,
        );
        const stagedMedia = await stageMediaLocally(
            workDoc.id,
            mediaParts,
            recoveryRetry ? null : quarantineThumbnailKey,
            {
                totalBytes: workDoc.manifest?.totalBytes,
                chunkSizes: workDoc.manifest?.chunkSizes,
                chunkSha256: workDoc.manifest?.chunkSha256,
            },
        );
        localMediaStaged = true;

        // Stage 1: restore the original byte stream, then scan all staged files.
        const localMediaPath = await assembleMediaParts(
            workDoc.id,
            stagedMedia.mediaPartPaths,
        );
        let processingMediaPath = localMediaPath;
        let recoveryApplied = false;

        if (recoveryRetry) {
            console.info(
                `[processMedia][${mediaId}][recovery] matching retry detected; skipping malware, MIME, and AI checks`,
            );
            const recovery = await runRecoveryAttempt(
                workDoc,
                mediaId,
                localMediaPath,
                sourceFingerprint,
                true,
            );
            processingMediaPath = recovery.mediaPath;
            recoveryApplied = true;
        } else {
            if (workDoc.manifest?.recovery?.attempted) {
                console.warn(
                    `[processMedia][${mediaId}][recovery] upload fingerprint changed or is missing; running all safety checks`,
                );
            }

            // Stage 1: scan the exact reconstructed source before native parsing.
            console.info(`[processMedia][${mediaId}][malware] scan started`);
            const malwareScan = await scanFolder(stagedMedia.sourceDirectory);
            if (malwareScan?.infected) {
                workDoc.quarantined = true;
                await cleanupLocalMedia(mediaId);
                localMediaStaged = false;
                await finishProcessing(workDoc);
                claimedProcessing = false;
                console.warn(`[processMedia][${mediaId}][malware] infection detected`);
                return successResult(mediaId, "quarantined", "malware_detected");
            }
            if (!malwareScan?.clean) {
                throw new Error("Malware scanner returned an invalid result");
            }
            console.info(`[processMedia][${mediaId}][malware] scan passed`);

            // Stage 2: detect the container from the restored complete upload.
            const mimeFormat = await detectMimeFromFile(localMediaPath);
            if (mimeFormat === "application/octet-stream") {
                workDoc.quarantined = true;
                await cleanupLocalMedia(mediaId);
                localMediaStaged = false;
                await finishProcessing(workDoc);
                claimedProcessing = false;
                console.warn(`[processMedia][${mediaId}][mime] unsupported signature`);
                return successResult(
                    mediaId,
                    "quarantined",
                    "unsupported_media_signature",
                );
            }
            console.info(`[processMedia][${mediaId}][mime] accepted ${mimeFormat}`);

            // Stage 3: moderate representative frames from the complete upload.
            console.info(`[processMedia][${mediaId}][moderation] validation started`);
            const validation = await enqueueAIValidation(localMediaPath);
            if (validation.decision !== "allow") {
                workDoc.censored = true;
                workDoc.quarantined = false;
                await cleanupLocalMedia(mediaId);
                localMediaStaged = false;
                await finishProcessing(workDoc);
                claimedProcessing = false;
                console.warn(
                    `[processMedia][${mediaId}][moderation] rejected with ${validation.decision}`,
                );
                return successResult(mediaId, "censored", "moderation_rejected");
            }
            console.info(`[processMedia][${mediaId}][moderation] allowed`);
        }

        // Stage 4: generate a safe local fallback when no thumbnail was uploaded.
        const thumbnailPath =
            stagedMedia.thumbnailPath ||
            (await generateMediaThumbnail(
                workDoc.id,
                processingMediaPath,
            ));

        // Stage 5: render the approved complete upload as a streamable HLS output.
        let concatData;
        try {
            concatData = await concatToStream(
                workDoc.id,
                processingMediaPath,
            );
        } catch (error) {
            if (!(error instanceof InvalidMediaStreamError)) {
                throw error;
            }

            if (recoveryApplied) {
                await markRecoveryExportFailure(workDoc, error);
                throw new Error("Recovered media failed HLS export", {
                    cause: error,
                });
            }

            const recovery = await runRecoveryAttempt(
                workDoc,
                mediaId,
                localMediaPath,
                sourceFingerprint,
                false,
            );
            try {
                concatData = await concatToStream(
                    workDoc.id,
                    recovery.mediaPath,
                );
                recoveryApplied = true;
            } catch (recoveryOutputError) {
                if (!(recoveryOutputError instanceof InvalidMediaStreamError)) {
                    throw recoveryOutputError;
                }

                await markRecoveryExportFailure(workDoc, recoveryOutputError);
                throw new Error("Recovered media failed HLS export", {
                    cause: recoveryOutputError,
                });
            }
        }

        // Stage 6: publish only generated HLS files and the staged thumbnail.
        const publicMedia = await commitMediaToPublic(
            workDoc.id,
            concatData,
            thumbnailPath,
        );
        localMediaStaged = false;
        workDoc.manifest.playlist = publicMedia.playlistKey;
        workDoc.manifest.thumbnail = publicMedia.thumbnailKey;
        workDoc.quarantined = false;

        await finishProcessing(workDoc);
        claimedProcessing = false;

        // Stage 7: remove exact quarantine sources only after state `done` is persisted.
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

        return successResult(
            mediaId,
            "processed",
            recoveryApplied ? "corrupt_media_recovered" : undefined,
        );
    } catch (error) {
        // the proccessing genuinly threw error and need investigating
        const handledError = error instanceof Error ? error : new Error(String(error));
        let message = handledError.message;
        console.error(
            `[processMedia][${mediaId}][failure] ${truncateRecoveryMessage(message)}`,
        );

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
                console.warn(
                    `[processMedia][${mediaId}][state] reset to need_process`,
                );
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

function buildRecoverySourceFingerprint(manifest) {
    const fingerprintSource = JSON.stringify({
        mediaParts: manifest?.mediaParts,
        totalBytes: manifest?.totalBytes,
        chunkSizes: manifest?.chunkSizes,
        chunkSha256: manifest?.chunkSha256,
    });

    return createHash("sha256").update(fingerprintSource).digest("hex");
}

function isMatchingRecoveryRetry(recovery, sourceFingerprint) {
    return (
        recovery?.attempted === true &&
        typeof recovery?.sourceFingerprint === "string" &&
        recovery.sourceFingerprint === sourceFingerprint
    );
}

async function runRecoveryAttempt(
    workDoc,
    mediaId,
    localMediaPath,
    sourceFingerprint,
    isRetry,
) {
    const previousRecovery = workDoc.manifest?.recovery;
    const previousAttempts =
        Number.isSafeInteger(previousRecovery?.attempts) &&
        previousRecovery.attempts > 0
            ? previousRecovery.attempts
            : previousRecovery?.attempted
                ? 1
                : 0;
    const attempts = previousAttempts + 1;
    const lastAttemptAt = new Date();

    workDoc.manifest.recovery = {
        attempted: true,
        attempts,
        lastAttemptAt,
        sourceFingerprint,
        succeeded: false,
        method: null,
        reason: "recovery_in_progress",
        videoRatio: null,
        audioRatio: null,
        lastError: null,
    };
    workDoc.quarantined = false;
    await workDoc.save();
    console.info(
        `[processMedia][${mediaId}][recovery] attempt=${attempts} mode=${isRetry ? "retry" : "initial"} started`,
    );

    let recovery;
    try {
        recovery = await recoverCorruptMedia(
            workDoc.id,
            localMediaPath,
        );
    } catch (error) {
        const handledError =
            error instanceof Error ? error : new Error(String(error));
        workDoc.manifest.recovery = toRecoveryManifest(
            {
                succeed: false,
                method: null,
                reason: "recovery_operational_failure",
                videoRatio: null,
                audioRatio: null,
            },
            {
                attempts,
                lastAttemptAt,
                sourceFingerprint,
                lastError: truncateRecoveryMessage(handledError.message),
            },
        );
        await workDoc.save();
        console.error(
            `[processMedia][${mediaId}][recovery] attempt=${attempts} operational failure: ${truncateRecoveryMessage(handledError.message)}`,
        );
        throw handledError;
    }

    workDoc.manifest.recovery = toRecoveryManifest(
        recovery,
        {
            attempts,
            lastAttemptAt,
            sourceFingerprint,
            lastError: null,
        },
    );
    await workDoc.save();

    if (!recovery.succeed) {
        const ratioSummary =
            `video=${formatRecoveryRatio(recovery.videoRatio)} ` +
            `audio=${formatRecoveryRatio(recovery.audioRatio)}`;
        console.warn(
            `[processMedia][${mediaId}][recovery] attempt=${attempts} unsuccessful reason=${recovery.reason} ${ratioSummary}; state will reset to need_process`,
        );
        throw new Error(
            `Media recovery was unsuccessful: ${recovery.reason} (${ratioSummary})`,
        );
    }

    console.info(
        `[processMedia][${mediaId}][recovery] attempt=${attempts} succeeded method=${recovery.method} video=${formatRecoveryRatio(recovery.videoRatio)} audio=${formatRecoveryRatio(recovery.audioRatio)}`,
    );
    return recovery;
}

async function markRecoveryExportFailure(workDoc, error) {
    const message =
        error instanceof Error ? error.message : String(error);
    workDoc.manifest.recovery.succeeded = false;
    workDoc.manifest.recovery.reason = "recovery_hls_export_rejected";
    workDoc.manifest.recovery.lastError = truncateRecoveryMessage(message);
    await workDoc.save();
    console.error(
        `[processMedia][${workDoc.id}][recovery] recovered input failed HLS export: ${truncateRecoveryMessage(message)}`,
    );
}

/**
 * Converts recovery output into bounded persisted diagnostics.
 *
 * @param {object} recovery
 * @param {boolean} recovery.succeed
 * @param {"structural"|"salvage"|null} recovery.method
 * @param {string} recovery.reason
 * @param {number|null} recovery.videoRatio
 * @param {number|null} recovery.audioRatio
 * @param {object} metadata
 * @param {number} metadata.attempts
 * @param {Date} metadata.lastAttemptAt
 * @param {string} metadata.sourceFingerprint
 * @param {string|null} metadata.lastError
 * @returns {{
 * attempted: true,
 * attempts: number,
 * lastAttemptAt: Date,
 * sourceFingerprint: string,
 * succeeded: boolean,
 * method: "structural"|"salvage"|null,
 * reason: string,
 * videoRatio: number|null,
 * audioRatio: number|null,
 * lastError: string|null
 * }}
 */
function toRecoveryManifest(recovery, metadata) {
    return {
        attempted: true,
        attempts: metadata.attempts,
        lastAttemptAt: metadata.lastAttemptAt,
        sourceFingerprint: metadata.sourceFingerprint,
        succeeded: recovery.succeed,
        method: recovery.method,
        reason: recovery.reason,
        videoRatio: recovery.videoRatio,
        audioRatio: recovery.audioRatio,
        lastError: metadata.lastError,
    };
}

function truncateRecoveryMessage(message) {
    return String(message).replace(/\s+/g, " ").trim().slice(0, 2048);
}

function formatRecoveryRatio(ratio) {
    return ratio === null ? "n/a" : ratio.toFixed(3);
}

/**
 * Creates a successful media-worker completion result.
 *
 * @param {string} _id
 * @param {"processed"|"quarantined"|"censored"} outcome
 * @param {string} [reason]
 * @returns {ProcessMediaResult} Successful result with status `200`.
 */
function successResult(_id, outcome, reason) {
    return {
        _id,
        succeed: true,
        status: 200,
        outcome,
        ...(typeof reason === "string" ? { reason } : {}),
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
