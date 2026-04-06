import { fork } from "node:child_process";
import { redisCache } from "../../helpers/redis/connectRedis.js";

/**
 * Redis-backed worker queue that spawns a child process when new jobs are pushed.
 */
export default class JobQueue {
    /**
     * @param {number} [index=0] Queue instance suffix used in logs.
     * @param {string} [redisKeySpace="__keyspace@0__:JobQueue"] Redis keyspace pattern to subscribe to.
     */
    constructor(index = 0, redisKeySpace = "__keyspace@0__:JobQueue") {
        this.name = `JobQueue${index ? " " + index : ""}`;
        this.procRef = null;
        this.subClone = redisCache.duplicate();
        this.isSubscribed = false;
        this.redisKeySpace = redisKeySpace;
        this.onSubscribe = this.onSubscribe.bind(this);
    }

    /**
     * Starts the worker process when a matching Redis push event arrives.
     *
     * @param {string} event Redis keyspace notification event name.
     * @param {string} _ Unused channel payload.
     * @returns {Promise<void>}
     */
    async onSubscribe(event, _) {
        if (!event.includes("push")) return;
        if (this.procRef) return;

        if (this.subClone?.isOpen && this.isSubscribed) await this.cacheCommand.unSub()

        this.procRef = fork("src/workers/jobQueue/JQORefacture.js");

        this.procRef.on("exit", async (code, signal) => {
            console.info(`${this.name} exited with code: ${code}, signal: ${signal}`);
            this.procRef = null;
            await this.cacheCommand.sub();
        });
    }

    /**
     * Initializes the Redis subscription or requests the active worker to stop.
     *
     * @returns {Promise<void>}
     */
    async initialize() {
        if (this.procRef) {
            this.procRef.send("stop");
            return;
        }

        await this.cacheCommand.sub();
    }

    cacheCommand = {
        /**
         * Closes and clears the duplicated Redis client.
         *
         * @returns {Promise<void>}
         */
        unSub: async () => {
            if (this.isSubscribed) {
                await this.subClone.pUnsubscribe(this.redisKeySpace, this.onSubscribe);
            }

            this.isSubscribed = false;
        },

        /**
         * Connects the duplicated Redis client and ensures the keyspace listener is subscribed.
         *
         * @returns {Promise<void>}
         */
        sub: async () => {
            if (!this.subClone) {
                this.subClone = redisCache.duplicate();
            }

            if (!this.subClone.isOpen) {
                await this.subClone.connect();
            }

            if (!this.isSubscribed) {
                await this.subClone.pSubscribe(this.redisKeySpace, this.onSubscribe);
                this.isSubscribed = true;
            }
        },
    };
}
