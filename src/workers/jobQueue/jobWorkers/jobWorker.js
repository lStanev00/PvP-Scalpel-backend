import { redisCache } from "../../../helpers/redis/connectRedis.js";
import threadBoot from "../../../helpers/threadBoot.js";
import prepareCharData from "./jobWorkerHelpers/prepareCharData.js";

await threadBoot(true);
const IDLE_TIMEOUT_MS = 30_000;
let idleTimer = undefined;

const workerName = process.env.WORKER_NAME;
let isDraining = false;

if (workerName !== "QueueWorker1" && workerName !== "QueueWorker2") {
    throw new Error(`Invalid workerName "${workerName}" provided to job worker.`);
}

const publishRetrieveCharacter = (result) =>
    redisCache.publish("job:retrieveCharacter", JSON.stringify(result));

const jobs = [];

process.on("message", async (jobInfo) => {
    clearIdleShutdown();
    jobs.push(jobInfo);

    if (isDraining) return;
    isDraining = true;

    try {
        while (jobs.length !== 0) {
            clearIdleShutdown();
            const currentJobInfo = jobs.shift();

            const { type, data } = currentJobInfo ?? {};

            if (type === "retrieveCharacter") {
                const result = await prepareCharData(data);
                void publishRetrieveCharacter(result).catch(console.error);
                process.send({
                    type: "retrieveCharacter",
                    data: {
                        search: result.search,
                        succeed: result.status === 200,
                        status: result.status,
                        job: currentJobInfo,
                    },
                });
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
});

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
