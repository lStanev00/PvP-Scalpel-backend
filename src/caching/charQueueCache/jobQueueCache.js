import { EventEmitter } from "node:events";
import { removeListCache } from "../../helpers/redis/deletersRedis.js";
import { listLengthCache, listValuesCache } from "../../helpers/redis/getterRedis.js";
import { pushListCache } from "../../helpers/redis/setterRedis.js";

const key = "JobQueue";
const humanReadableName = "Job Queue Cache";

/**
 * Validate one job queue entry before using it against Redis.
 *
 * @param {string} jobEntry
 * @returns {string}
 */
function validateJobQueueEntry(jobEntry) {
    if (typeof jobEntry !== "string") {
        throw new TypeError("Job queue entry must be a string.");
    }

    return jobEntry;
}

export const JobQueueCacheEmitter = new EventEmitter();

JobQueueCacheEmitter.on("update", (msg) => console.log(`[${humanReadableName}] ${msg}`));
JobQueueCacheEmitter.on("error", (msg) => console.error(`[${humanReadableName} ERROR] ${msg}`));
JobQueueCacheEmitter.on("info", (msg) => console.info(`[${humanReadableName} INFO] ${msg}`));

/**
 * Read the queue from oldest queued job entry to newest queued job entry.
 *
 * @returns {Promise<string[]>}
 */
export async function getJobQueueEntries() {
    return await listValuesCache(key);
}

/**
 * Check whether one job queue entry already exists in the ordered queue.
 *
 * @param {string} jobEntry
 * @returns {Promise<boolean>}
 */
export async function hasJobQueueEntry(jobEntry) {
    try {
        const validatedJobEntry = validateJobQueueEntry(jobEntry);
        const jobEntries = await listValuesCache(key);

        return jobEntries.includes(validatedJobEntry);
    } catch (error) {
        JobQueueCacheEmitter.emit("error", `hasJobQueueEntry invoked with invalid job entry: ${jobEntry}`);
        console.warn(error);
        return false;
    }
}

/**
 * Append one job queue entry to the global Redis list when it is not already queued.
 * Existing entries stay in place so duplicate enqueue attempts are a no-op.
 *
 * @param {string} jobEntry
 * @param {number} [ttl=-1]
 * @returns {Promise<number|null>}
 */
export async function enqueueJobQueueEntry(jobEntry, ttl = -1) {
    try {
        const validatedJobEntry = validateJobQueueEntry(jobEntry);
        const jobEntries = await listValuesCache(key);

        if (jobEntries.includes(validatedJobEntry)) {
            return 0;
        }

        const result = await pushListCache(key, validatedJobEntry, ttl);

        if (result !== null) {
            JobQueueCacheEmitter.emit("update", `Queued job entry: ${validatedJobEntry}`);
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
 * @param {string} jobEntry
 * @returns {Promise<boolean>}
 */
export async function deleteJobQueueEntry(jobEntry) {
    try {
        const validatedJobEntry = validateJobQueueEntry(jobEntry);
        const deletedCount = await removeListCache(key, validatedJobEntry);
        const deleted = deletedCount !== null && deletedCount > 0;

        if (deleted) {
            JobQueueCacheEmitter.emit("info", `Deleted job queue entry: ${validatedJobEntry}`);
        }

        return deleted;
    } catch (error) {
        JobQueueCacheEmitter.emit("error", `deleteJobQueueEntry invoked with invalid job entry: ${jobEntry}`);
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
