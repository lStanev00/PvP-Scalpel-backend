/** @typedef {import("../jobQueue.types.js").RetrieveCharacterJobData} RetrieveCharacterJobData */
/** @typedef {import("../jobQueue.types.js").BulkRetrieveCharacterResult} BulkRetrieveCharacterResult */
/** @typedef {import("../jobQueue.types.js").BulkRetrieveCharacterWorkerMessage} BulkRetrieveCharacterWorkerMessage */
/** @typedef {import("../jobQueue.types.js").QueueWorkerJob} QueueWorkerJob */
/** @typedef {import("../jobQueue.types.js").RetrieveCharacterResult} RetrieveCharacterResult */
/** @typedef {import("../jobQueue.types.js").RetrieveCharacterWorkerMessage} RetrieveCharacterWorkerMessage */
/** @typedef {import("../jobQueue.types.js").ProcessMediaWorkerMessage} ProcessMediaWorkerMessage */
import { redisCache } from "../../../helpers/redis/connectRedis.js";
import threadBoot from "../../../helpers/threadBoot.js";
import prepareCharData from "./jobWorkerHelpers/prepareCharData.js";
import processMedia from "./jobWorkerHelpers/processMedia.js";

await threadBoot(true);
const IDLE_TIMEOUT_MS = 30_000;
let idleTimer = undefined;

const workerName = process.env.WORKER_NAME;
let isDraining = false;

if (!["QueueWorker1", "QueueWorker2", "QueueWorker3"].includes(workerName)) {
    throw new Error(`Invalid workerName "${workerName}" provided to job worker.`);
}

/**
 * Publish character data separately from the IPC completion metadata.
 * @param {RetrieveCharacterResult} result
 * @returns {Promise<number>}
 */
const publishRetrieveCharacter = (result) =>
    redisCache.publish("job:retrieveCharacter", JSON.stringify(result));

const publishVideoToZugee = (mediaID) =>
    redisCache.publish("annoDiscord:newVideo", JSON.stringify(mediaID));

/** @type {QueueWorkerJob[]} */
const jobs = [];

process.on(
    "message",
    /**
     * Queue a character, bulk-character, or media job and drain jobs in arrival order.
     * @param {QueueWorkerJob} jobInfo
     * @returns {Promise<void>}
     */ async (jobInfo) => {
        clearIdleShutdown();
        jobs.push(jobInfo);

        if (isDraining) return;
        isDraining = true;

        try {
            while (jobs.length !== 0) {
                clearIdleShutdown();
                const currentJobInfo = /** @type {QueueWorkerJob} */ (jobs.shift());

                const { type, data, id } = currentJobInfo ?? {};

                if (type === "retrieveCharacter") {
                    const result = await prepareCharData(data);
                    void publishRetrieveCharacter(result).catch(console.error);
                    process.send(
                        /** @type {RetrieveCharacterWorkerMessage} */ ({
                            type: "retrieveCharacter",
                            data: {
                                search: result.search,
                                succeed: result.status === 200,
                                status: result.status,
                                job: currentJobInfo,
                            },
                        }),
                    );
                } else if (type === "processMedia") {
                    const result = await processMedia(currentJobInfo);
                    if (result.status === 200 && result.outcome === "processed") {
                        void (await publishVideoToZugee(result._id));
                    }
                    process.send(
                        /** @type {ProcessMediaWorkerMessage} */ ({
                            type: "processMedia",
                            data: {
                                ...result,
                                job: currentJobInfo,
                            },
                        }),
                    );
                } else if (type === "bulkRetrieveCharacter") {
                    /** @type {BulkRetrieveCharacterResult[]} */
                    const retrived = [];
                    /**
                     * @param {RetrieveCharacterJobData} charData
                     * @returns {Promise<void>}
                     */
                    const charRet = async (charData) => {
                        const result = await prepareCharData(charData);
                        await publishRetrieveCharacter(result).catch(console.error);
                        retrived.push({
                            search: result.search,
                            succeed: result.status === 200,
                            status: result.status,
                        });
                    };
                    const jobs = [];
                    for (const entry of data) jobs.push(charRet(entry));
                    await Promise.all(jobs);
                    process.send(
                        /** @type {BulkRetrieveCharacterWorkerMessage} */ ({
                            id,
                            type,
                            data: {
                                results: retrived,
                                job: currentJobInfo,
                            },
                        }),
                    );
                }
            }
        } catch (e) {
            console.error(e);
        } finally {
            isDraining = false;
            scheduleIdleShutdown();

            // process.send({
            //     type: "jobLess"
            // })
        }
    },
);

function clearIdleShutdown() {
    if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = undefined;
    }
}

function scheduleIdleShutdown() {
    clearIdleShutdown();

    idleTimer = setTimeout(() => {
        if (jobs.length !== 0 || isDraining) return;
        process.disconnect?.();
        process.exit(0);
    }, IDLE_TIMEOUT_MS);
}
