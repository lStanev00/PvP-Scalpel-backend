import { EventEmitter } from "node:events";
import { removeListCache } from "../../helpers/redis/deletersRedis.js";
import { listLengthCache, listValuesCache } from "../../helpers/redis/getterRedis.js";
import { pushListCache } from "../../helpers/redis/setterRedis.js";
import normalizeCharacterSearch from "../../helpers/normalizeCharacterSearch.js";

const key = "JobQueue";
const humanReadableName = "Job Queue Cache";

/**
 * One character-search payload queued for worker processing.
 *
 * @typedef {object} CharacterQueueJobData
 * @property {string} search
 * @property {boolean} [incChecks]
 * @property {boolean} [incChechks]
 * @property {boolean} [renewCache]
 */

/**
 * One single-character queue entry stored in the global Redis queue.
 *
 * @typedef {object} RetrieveCharacterQueueJob
 * @property {"retrieveCharacter"} type
 * @property {CharacterQueueJobData} data
 */

/**
 * One bulk queue entry stored in the global Redis queue.
 *
 * @typedef {object} BulkRetrieveCharacterQueueJob
 * @property {"bulkRetrieveCharacter"} type
 * @property {CharacterQueueJobData[]} data
 */

/**
 * One job entry stored in the global Redis queue.
 *
 * @typedef {RetrieveCharacterQueueJob | BulkRetrieveCharacterQueueJob} QueueJob
 */

/**
 * Validate one job queue entry before using it against Redis.
 *
 * @param {QueueJob} jobEntry
 * @returns {QueueJob}
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

    throw new TypeError(`Unsupported job queue entry type "${jobEntry.type}".`);
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
