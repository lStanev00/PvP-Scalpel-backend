/** @typedef {import("../../workers/jobQueue/jobQueue.types.js").CharacterQueueJobData} CharacterQueueJobData */
/** @typedef {import("../../workers/jobQueue/jobQueue.types.js").RetrieveCharacterQueueJob} RetrieveCharacterQueueJob */
/** @typedef {import("../../workers/jobQueue/jobQueue.types.js").BulkRetrieveCharacterQueueJob} BulkRetrieveCharacterQueueJob */
/** @typedef {import("../../workers/jobQueue/jobQueue.types.js").ProcessMediaQueueJob} ProcessMediaQueueJob */
/** @typedef {import("../../workers/jobQueue/jobQueue.types.js").QueueJob} QueueJob */
import { EventEmitter } from "node:events";
import { removeListCache } from "../../helpers/redis/deletersRedis.js";
import { listLengthCache, listValuesCache } from "../../helpers/redis/getterRedis.js";
import { pushListCache } from "../../helpers/redis/setterRedis.js";
import normalizeCharacterSearch from "../../helpers/normalizeCharacterSearch.js";

const key = "JobQueue";
const humanReadableName = "Job Queue Cache";

/**
 * Normalize one character payload before storing it in the queue.
 *
 * @param {CharacterQueueJobData} jobData
 * @param {"retrieveCharacter" | "bulkRetrieveCharacter"} jobType
 * @returns {CharacterQueueJobData}
 */
function validateCharacterQueueJobData(jobData, jobType) {
    if (!jobData || typeof jobData !== "object" || Array.isArray(jobData)) {
        throw new TypeError(`${jobType} job data must be an object.`);
    }

    const normalizedSearch = normalizeCharacterSearch(jobData.search);
    if (!normalizedSearch) {
        throw new TypeError(`${jobType} jobs require a canonical non-empty search value.`);
    }

    return {
        ...jobData,
        search: normalizedSearch,
    };
}

/**
 * Validate and normalize one queue entry before using it against Redis.
 *
 * @param {QueueJob} jobEntry
 * @returns {QueueJob}
 */
function validateJobQueueEntry(jobEntry) {
    if (!jobEntry || typeof jobEntry !== "object" || Array.isArray(jobEntry)) {
        throw new TypeError("Job queue entry must be an object.");
    }

    if (typeof jobEntry.type !== "string") {
        throw new TypeError("Job queue entry type must be a string.");
    }

    if (jobEntry.type === "retrieveCharacter") {
        return {
            ...jobEntry,
            data: validateCharacterQueueJobData(jobEntry.data, "retrieveCharacter"),
        };
    }

    if (jobEntry.type === "bulkRetrieveCharacter") {
        if (!Array.isArray(jobEntry.data)) {
            throw new TypeError("bulkRetrieveCharacter job data must be an array.");
        }
        if (jobEntry.data.length === 0) {
            throw new TypeError("bulkRetrieveCharacter job data cannot be empty.");
        }

        return {
            ...jobEntry,
            data: jobEntry.data.map((jobData) =>
                validateCharacterQueueJobData(jobData, "bulkRetrieveCharacter"),
            ),
        };
    }

    if (jobEntry.type === "processMedia") {
        if (!jobEntry.data || typeof jobEntry.data !== "object" || Array.isArray(jobEntry.data)) {
            throw new TypeError("processMedia job data must be an object.");
        }

        const mediaId =
            typeof jobEntry.data._id === "string"
                ? jobEntry.data._id.trim().toLowerCase()
                : "";

        if (!/^[a-f\d]{24}$/.test(mediaId)) {
            throw new TypeError("processMedia jobs require a valid 24-character hexadecimal _id.");
        }

        return {
            ...jobEntry,
            data: {
                ...jobEntry.data,
                _id: mediaId,
            },
        };
    }

    throw new TypeError(`Unsupported job queue entry type "${/** @type {{ type: string }} */ (jobEntry).type}".`);
}

export const JobQueueCacheEmitter = new EventEmitter();

JobQueueCacheEmitter.on("update", (msg) => console.log(`[${humanReadableName}] ${msg}`));
JobQueueCacheEmitter.on("error", (msg) => console.error(`[${humanReadableName} ERROR] ${msg}`));
JobQueueCacheEmitter.on("info", (msg) => console.info(`[${humanReadableName} INFO] ${msg}`));

/**
 * Read the queue from oldest queued job entry to newest queued job entry.
 *
 * @returns {Promise<QueueJob[]>}
 */
export async function getJobQueueEntries() {
    return await listValuesCache(key);
}

/**
 * Check whether one job queue entry already exists in the ordered queue.
 *
 * @param {QueueJob} jobEntry
 * @returns {Promise<boolean>}
 */
export async function hasJobQueueEntry(jobEntry) {
    try {
        const validatedJobEntry = validateJobQueueEntry(jobEntry);
        const jobEntries = await listValuesCache(key);
        const serializedJobEntry = JSON.stringify(validatedJobEntry);

        return jobEntries.some((entry) => JSON.stringify(entry) === serializedJobEntry);
    } catch (error) {
        JobQueueCacheEmitter.emit("error", `hasJobQueueEntry invoked with invalid job entry.`);
        console.warn(error);
        return false;
    }
}

/**
 * Append one job queue entry to the global Redis list when it is not already queued.
 * Existing entries stay in place so duplicate enqueue attempts are a no-op.
 *
 * @param {QueueJob} jobEntry
 * @param {number} [ttl=-1]
 * @returns {Promise<number|null>}
 */
export async function enqueueJobQueueEntry(jobEntry, ttl = -1) {
    try {
        const validatedJobEntry = validateJobQueueEntry(jobEntry);
        const jobEntries = await listValuesCache(key);
        const serializedJobEntry = JSON.stringify(validatedJobEntry);

        if (jobEntries.some((entry) => JSON.stringify(entry) === serializedJobEntry)) {
            return 0;
        }

        const result = await pushListCache(key, validatedJobEntry, ttl);

        if (result !== null) {
            JobQueueCacheEmitter.emit("update", `Queued job entry: ${validatedJobEntry.type}`);
        }

        return result;
    } catch (error) {
        JobQueueCacheEmitter.emit("error", "enqueueJobQueueEntry invoked with invalid job queue params.");
        console.warn(error);
        return null;
    }
}

/**
 * Append one media-processing job to the global Redis queue.
 *
 * @param {string} mediaId
 * @param {number} [ttl=-1]
 * @returns {Promise<number|null>}
 */
export async function enqueueMediaJob(mediaId, ttl = -1) {
    return await enqueueJobQueueEntry(
        /** @satisfies {ProcessMediaQueueJob} */
        ({
            type: "processMedia",
            data: {
                _id: mediaId,
            },
        }),
        ttl,
    );
}

/**
 * Remove one job queue entry from the global Redis list.
 * If stale duplicates exist, all matching entries are removed.
 *
 * @param {QueueJob} jobEntry
 * @returns {Promise<boolean>}
 */
export async function deleteJobQueueEntry(jobEntry) {
    try {
        const validatedJobEntry = validateJobQueueEntry(jobEntry);
        const deletedCount = await removeListCache(key, validatedJobEntry);
        const deleted = deletedCount !== null && deletedCount > 0;

        // if (deleted) {
        //     JobQueueCacheEmitter.emit("info", `Deleted job queue entry: ${validatedJobEntry}`);
        // }

        return deleted;
    } catch (error) {
        JobQueueCacheEmitter.emit("error", `deleteJobQueueEntry invoked with invalid job entry.`);
        console.warn(error);
        return false;
    }
}

/**
 * Read the current number of queued job entries.
 *
 * @returns {Promise<number>}
 */
export async function getJobQueueSize() {
    return await listLengthCache(key);
}
