import { redisCache } from "../../../helpers/redis/connectRedis.js";
import getCache from "../../../helpers/redis/getterRedis.js";
import setCache from "../../../helpers/redis/setterRedis.js";
import threadBoot from "../../../helpers/threadBoot.js";
import JQOLog from "../JQOLoog.js";
import prepareCharData from "./jobWorkerHelpers/prepareCharData.js";

await threadBoot(true);

const workerName = process.env.WORKER_NAME;
let isDraining = false;

if (workerName !== "QueueWorker1" && workerName !== "QueueWorker2") {
    throw new Error(`Invalid workerName "${workerName}" provided to job worker.`);
}

const publishRetrieveCharacter = (result) =>
    redisCache.publish("job:retrieveCharacter", JSON.stringify(result));

const getWorkerJobs = async () => {
    const jobs = await getCache("jobs", workerName);
    return Array.isArray(jobs) ? jobs : [];
};
const setWorkerJobs = async (jobs) => await setCache("jobs", jobs, workerName);

process.on("message", async (jobInfo) => {
    const jobs = await getWorkerJobs();
    jobs.push(jobInfo);
    await setWorkerJobs(jobs);

    if (isDraining) return;
    isDraining = true;

    try {
        while (true) {
            const queuedJobs = await getWorkerJobs();
            if (queuedJobs.length === 0) break;

            const [currentJobInfo, ...remainingJobs] = queuedJobs;
            JQOLog.info(JSON.stringify(currentJobInfo));
            await setWorkerJobs(remainingJobs);

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
                    },
                });
            }
        }
    } catch (e) {
        console.error(e);
    } finally {
        isDraining = false;
        // await setWorkerRunning(false);
        process.exit(0);
    }
});
