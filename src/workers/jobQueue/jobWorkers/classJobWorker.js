import { fork } from "node:child_process";
import getCache, { setHasValueCache } from "../../../helpers/redis/getterRedis.js";
import setCache, { addSetCache } from "../../../helpers/redis/setterRedis.js";
import JQOLog from "../JQOLoog.js";
import { removeSetCache } from "../../../helpers/redis/deletersRedis.js";
import WorkerError from "../../../Models/WorkerErrors.js";

const queuedCharKey = "queuedCharSet";
const queueCharacterSearch = async (search) => await addSetCache(queuedCharKey, search);
const hasQueuedCharacterSearch = async (search) => await setHasValueCache(queuedCharKey, search);
const dequeueCharacterSearch = async (search) => await removeSetCache(queuedCharKey, search);

/**
 * Payload for the `retrieveCharacter` job handled by `jobWorker.js`.
 *
 * `search` must be the normalized character key in the form `name:realm:server`.
 *
 * @typedef {object} RetrieveCharacterJobData
 * @property {string} search
 * @property {boolean} [incChecks]
 * @property {boolean} [incChechks]
 * @property {boolean} [renewCache]
 */

/**
 * One job message sent from the orchestrator to the child-process queue worker.
 *
 * Currently the worker only handles `type === "retrieveCharacter"`.
 *
 * @typedef {object} QueueWorkerJob
 * @property {string} type
 * @property {RetrieveCharacterJobData} data
 */

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
        this.listenerRef = undefined;
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

        await this.onMessage();
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
     * Expected payload shape:
     * - `type`: job discriminator, currently `"retrieveCharacter"`
     * - `data.search`: normalized character key in the form `name:realm:server`
     * - `data.incChecks` / `data.incChechks`: optional checked-count increment flag
     * - `data.renewCache`: optional cache-bypass flag
     *
     * Example:
     * `{ type: "retrieveCharacter", data: { search: "name:realm:server", renewCache: true } }`
     *
     * @param {QueueWorkerJob} jobInfo
     * @returns {Promise<boolean>}
     */
    async pushJob(jobInfo) {
        if (this.processRef === undefined) await this.initWorker();

        return this.processRef.send(jobInfo);
    }

    /**
     * Marks the worker as stopped in Redis and kills the child process reference.
     *
     * @returns {Promise<void>}
     */
    async handleExit(shouldKill = true) {
        await setCache("isRunning", false, this.name);
        // await setCache("jobs", [], this.name);

        if (shouldKill) this.processRef.kill("SIGKILL");
        this.isRunning = false;
        this.processRef = undefined;
        this.listenerRef = undefined;
    }

    /**
     * Queues one character-search job for this worker after checking whether the
     * same normalized `search` key is already marked as queued in the orchestrator.
     *
     * Expected input:
     * - `search`: normalized character key in the form `name:realm:server`
     * - `incChecks` / `incChechks`: optional checked-count increment flag
     * - `renewCache`: optional cache-bypass flag
     *
     * The method wraps the payload into a queue-worker job object:
     * `{ type: "retrieveCharacter", data }`
     *
     * @param {RetrieveCharacterJobData} data
     * @returns {Promise<boolean | undefined>}
     */
    async retrieveCharacter(data) {
        const { search } = data;

        const charQueued = await hasQueuedCharacterSearch(search);
        if (charQueued) return;

        const queueJob = {
            type: "retrieveCharacter",
            data: data,
        };
        await queueCharacterSearch(search);
        return await this.pushJob(queueJob);
    }

    async onMessage() {
        if (!this.isRunning || this.processRef === undefined) {
            return JQOLog.warn(
                `Can't register on message event listener for worker ${this.name} the proccess's not running`,
            );
        }
        if (this.listenerRef !== undefined)
            return JQOLog.warn(`The listrener is already registered for ${this.name}`);

        this.listenerRef = {
            message: this.processRef.on("message", async (msg) => {
                const { type, data } = msg;

                if (type === "retrieveCharacter") {
                    const { succeed, search } = data;
                    if (search) await dequeueCharacterSearch(search).catch(JQOLog.error);
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
                }
            }),
            exit: this.processRef.on("exit", async () => await this.handleExit(false)),
        };
    }
}
