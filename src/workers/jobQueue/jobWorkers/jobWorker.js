import { redisCache } from "../../../helpers/redis/connectRedis.js";
// import getCache from "../../../helpers/redis/getterRedis.js";
// import setCache from "../../../helpers/redis/setterRedis.js";
import threadBoot from "../../../helpers/threadBoot.js";
import prepareCharData from "./jobWorkerHelpers/prepareCharData.js";

await threadBoot(true);

const workerName = process.env.WORKER_NAME;
let isDraining = false;

if (workerName !== "QueueWorker1" && workerName !== "QueueWorker2") {
    throw new Error(`Invalid workerName "${workerName}" provided to job worker.`);
}

const publishRetrieveCharacter = (result) =>
    redisCache.publish("job:retrieveCharacter", JSON.stringify(result));

const jobs = [];

process.on("message", async (jobInfo) => {

    jobs.push(jobInfo);

    if (isDraining) return;
    isDraining = true;

    try {
        while (jobs.length !== 0) {

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
                        job: currentJobInfo
                    },
                });
            }
        }
    } catch (e) {
        console.error(e);
    } finally {
        isDraining = false;

        process.send({
            type: "jobLess"
        })
        // await setWorkerRunning(false);
        // process.exit(0);
    }
});
