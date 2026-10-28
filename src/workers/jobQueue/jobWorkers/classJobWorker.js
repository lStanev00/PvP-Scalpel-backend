/** @typedef {import("../jobQueue.types.js").RetrieveCharacterJobData} RetrieveCharacterJobData */
/** @typedef {import("../jobQueue.types.js").ProcessMediaJobData} ProcessMediaJobData */
/** @typedef {import("../jobQueue.types.js").RetrieveCharacterQueueJob} RetrieveCharacterQueueJob */
/** @typedef {import("../jobQueue.types.js").BulkRetrieveCharacterQueueJob} BulkRetrieveCharacterQueueJob */
/** @typedef {import("../jobQueue.types.js").ProcessMediaQueueJob} ProcessMediaQueueJob */
/** @typedef {import("../jobQueue.types.js").QueueWorkerJob} QueueWorkerJob */
/** @typedef {import("../jobQueue.types.js").QueueWorkerMessage} QueueWorkerMessage */
import { fork } from "node:child_process";
import getCache from "../../../helpers/redis/getterRedis.js";
import setCache, { setCacheIfAbsent } from "../../../helpers/redis/setterRedis.js";
import JQOLog from "../JQOLoog.js";
import delCache from "../../../helpers/redis/deletersRedis.js";
import WorkerError from "../../../Models/WorkerErrors.js";
import normalizeCharacterSearch from "../../../helpers/normalizeCharacterSearch.js";
import { QueueClaimTTL } from "../../../helpers/redis/connectRedis.js";

const queueClaimKey = (search) => `queuedChar:${search}`;
const queueCharacterSearch = async (search) =>
    await setCacheIfAbsent(queueClaimKey(search), true, 15, QueueClaimTTL);
const dequeueCharacterSearch = async (search) =>
    await delCache(queueClaimKey(search), "", QueueClaimTTL);

/**
 * Thin wrapper around one child-process queue worker and its Redis-backed state.
 */
export default class QueueWorker {
    /**
     * @param {string} name Redis hash / process identity for this worker.
     */
    constructor(name) {
        if (typeof name !== "string") throw new TypeError("The name value has to be a string");
        this.name = name;
        this.processRef = undefined;
        this.listenerRef = {
            message: undefined,
            exit: undefined,
        };
        this.isRunning = false;
    }

    /**
     * Initializes Redis state for the worker and spawns the child process if needed.
     *
     * @returns {Promise<void>}
     */
    async initWorker() {
        await setCache("isRunning", true, this.name);
        await setCache("jobs", [], this.name);

        this.processRef = fork("src/workers/jobQueue/jobWorkers/jobWorker.js", [], {
            env: {
                ...process.env,
                WORKER_NAME: this.name,
            },
        });
        this.isRunning = true;

        await this.registerListeners();
        JQOLog.info(`${this.name} spawned`);
    }

    /**
     * Reads the current queued-job snapshot for this worker from Redis.
     *
     * @returns {Promise<QueueWorkerJob[] | null>}
     */
    async getQueuedJobs() {
        return await getCache("jobs", this.name);
    }

    /**
     * Sends one job to the child-process worker.
     *
     * Accepts individual character-retrieval, bulk-character, and media-processing jobs.
     *
     * @param {QueueWorkerJob} jobInfo
     * @returns {Promise<boolean>}
     */
    async pushJob(jobInfo) {
        if (this.processRef === undefined) await this.initWorker();

        await this.addWorkerJob(jobInfo);
        return this.processRef.send(jobInfo);
    }

    /**
     * Marks the worker as stopped in Redis and clears its process reference.
     *
     * @returns {Promise<void>}
     */
    handleExit = async () => {
        const processRef = this.processRef;
        const { message, exit } = this.listenerRef;

        await setCache("isRunning", false, this.name);

        if (processRef !== undefined) {
            if (message !== undefined) processRef.removeListener("message", message);
            if (exit !== undefined) processRef.removeListener("exit", exit);
        }

        this.isRunning = false;
        this.processRef = undefined;
        this.listenerRef = {
            message: undefined,
            exit: undefined,
        };
    };

    /**
     * Queues one character-search job for this worker after checking whether the
     * same normalized `search` key is already marked as queued in the orchestrator.
     *
     * Expected input:
     * - `search`: normalized character key in the form `name:realm:server`
     * - `incChecks` / `incChechks`: optional checked-count increment flag
     * - `renewCache`: optional cache-bypass flag
     * - `minimal`: optional core-data-only flag
     *
     * The method wraps the payload into a queue-worker job object:
     * `{ type: "retrieveCharacter", data }`
     *
     * @param {RetrieveCharacterJobData} data
     * @returns {Promise<boolean | undefined>}
     */
    async retrieveCharacter(data) {
        const search = normalizeCharacterSearch(data?.search);
        if (!search) {
            JQOLog.warn(
                `Skipping retrieveCharacter for ${this.name} because search is invalid: ${JSON.stringify(data?.search)}`,
            );
            return false;
        }

        /** @type {RetrieveCharacterQueueJob} */
        const queueJob = {
            type: "retrieveCharacter",
            data: {
                ...data,
                search,
            },
        };

        const queueClaim = await queueCharacterSearch(search);
        if (queueClaim !== 1) return queueClaim === null ? false : undefined;

        return await this.pushJob(queueJob);
    }

    /**
     * @param {RetrieveCharacterJobData[]} data Raw data array from a bulkRetrieveCharacter queue entry.
     */
    async processBulkRetrieveCharacter(data) {
        /** @type {RetrieveCharacterJobData[]} */
        const bulkJobs = [];
        for (const entry of data) {
            const search = normalizeCharacterSearch(entry?.search);
            if (!search) {
                JQOLog.warn(
                    `Skipping bulkRetrieveCharacter for ${this.name} because search is invalid: ${JSON.stringify(entry?.search)}`,
                );
                continue;
            }

            const queueClaim = await queueCharacterSearch(search);
            if (queueClaim !== 1) continue;

            bulkJobs.push({
                ...entry,
                search,
            });
        }

        if (bulkJobs.length) {
            /** @type {BulkRetrieveCharacterQueueJob} */
            const queueJob = {
                type: "bulkRetrieveCharacter",
                data: bulkJobs,
            };

            return await this.pushJob(queueJob);
        } else {
            return null;
        }
    }

    /**
     * Dispatch one media job unless its ID is already queued for this worker.
     *
     * @param {ProcessMediaQueueJob} job
     * @returns {Promise<boolean | undefined>}
     */
    async processMedia(job) {
        const { type, data } = job;
        if (type !== "processMedia") {
            return JQOLog.warn(`${type} is not processMedia`);
        }

        if (!data._id) {
            return JQOLog.warn("there's no id in the job : processMedia");
        }
        const jobs = await this.getWorkerJobs();
        const exists = jobs.some((entry) => entry?.data?._id === data._id);

        if (exists) {
            return JQOLog.warn(
                `ProcessMedia job already exists for ${data._id}; skipping duplicate:\n${JSON.stringify(job, null, 2)}`,
            );
        }

        return await this.pushJob(job);
    }

    /**
     * Register completion and exit listeners for the current child process.
     * @returns {Promise<void>}
     */
    async registerListeners() {
        if (!this.isRunning || this.processRef === undefined) {
            return JQOLog.warn(
                `Can't register on message event listener for worker ${this.name} the proccess's not running`,
            );
        }
        if (this.listenerRef.message !== undefined || this.listenerRef.exit !== undefined)
            return JQOLog.warn(`The listrener is already registered for ${this.name}`);

        const onWorkerMessage = this.onWorkerMessage;
        const onWorkerExit = this.handleExit;

        this.processRef.on("message", onWorkerMessage);
        this.processRef.once("exit", onWorkerExit);
        this.listenerRef = {
            message: onWorkerMessage,
            exit: onWorkerExit,
        };
    }

    /**
     * Reads the current Redis-backed job list for this worker.
     *
     * @returns {Promise<QueueWorkerJob[]>}
     */
    async getWorkerJobs() {
        /** @type {QueueWorkerJob[] | null} */
        const jobs = await getCache("jobs", this.name);
        return Array.isArray(jobs) ? jobs : [];
    }

    /**
     * Replaces the Redis-backed job list for this worker.
     *
     * @param {QueueWorkerJob[]} jobs
     * @returns {Promise<boolean>}
     */
    setWorkerJobs = async (jobs) => await setCache("jobs", jobs, this.name);

    /**
     * Appends one job to this worker's Redis-backed job list.
     *
     * @param {QueueWorkerJob} job
     * @returns {Promise<void>}
     */
    async addWorkerJob(job) {
        const jobs = await this.getWorkerJobs();
        jobs.push(job);
        await this.setWorkerJobs(jobs);
    }

    /**
     * Removes the first matching job from this worker's Redis-backed job list.
     *
     * Matching prefers direct object identity and falls back to JSON equality.
     *
     * @param {QueueWorkerJob} job
     * @returns {Promise<boolean>}
     */
    async removeWorkerJob(job) {
        const jobs = await this.getWorkerJobs();
        const directIndex = jobs.indexOf(job);

        if (directIndex !== -1) {
            jobs.splice(directIndex, 1);
            await this.setWorkerJobs(jobs);
            return true;
        }

        const serializedJob = JSON.stringify(job);
        const jobIndex = jobs.findIndex((entry) => JSON.stringify(entry) === serializedJob);

        if (jobIndex === -1) return false;

        jobs.splice(jobIndex, 1);
        await this.setWorkerJobs(jobs);
        return true;
    }

    /**
     * Handle a completion, release character claims, and remove the original job.
     *
     * @param {QueueWorkerMessage} msg
     * @returns {Promise<void>}
     */
    onWorkerMessage = async (msg) => {
        const { type, data } = msg;

        if (type === "retrieveCharacter") {
            const { succeed, search, job } = data;
            if (search) await dequeueCharacterSearch(search).catch(JQOLog.error);
            if (job) await this.removeWorkerJob(job);
            if (!succeed && search) {
                await WorkerError.create({
                    workerName: this.name,
                    source: "QueueWorker.onMessage",
                    jobType: type,
                    search,
                    message: `Worker ${this.name} failed to process retrieveCharacter job.`,
                    stack: typeof data?.stack === "string" ? data.stack : undefined,
                    context: data,
                }).catch(JQOLog.error);
            }
        } else if (type === "processMedia") {
            const job = data?.job;
            if (!job) return JQOLog.warn("processMedia completion is missing its job data");

            await this.removeWorkerJob(job).catch(JQOLog.error);
            const mediaId = data?._id ?? job.data?._id ?? "unknown";

            if (data?.succeed) {
                const reason = typeof data?.reason === "string" ? ` (${data.reason})` : "";
                JQOLog.info(
                    `Worker ${this.name} completed processMedia ${mediaId} with outcome ${data.outcome}${reason}`,
                );
                return;
            }
            const status = data.status ? Number(data.status) : 0;
            if (status === 0) {
                JQOLog.warn(
                    `There was a problem with the status code on the following object: \n ${JSON.stringify(data, null, 4)}`,
                );
            } else if (status.toString().startsWith("4") || status.toString().startsWith("5")) {
                const failureDetails =
                    typeof data?.message === "string"
                        ? `: ${data.message.replace(/\s+/g, " ").trim().slice(0, 512)}`
                        : "";
                JQOLog.error(
                    `Worker ${this.name} failed processMedia ${mediaId} with status ${status}${failureDetails}`,
                );
                await WorkerError.create({
                    workerName: this.name,
                    source: "QueueWorker.onMessage",
                    jobType: type,
                    message:
                        typeof data?.message === "string"
                            ? data.message
                            : `Worker ${this.name} failed to process media ${mediaId}.`,
                    stack: typeof data?.stack === "string" ? data.stack : undefined,
                    context: data,
                }).catch(JQOLog.error);
            }
        }
    };
}
