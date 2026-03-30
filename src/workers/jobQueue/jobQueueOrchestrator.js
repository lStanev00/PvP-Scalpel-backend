import {
    deleteJobQueueEntry,
    getJobQueueEntries,
    getJobQueueSize,
} from "../../caching/charQueueCache/jobQueueCache.js";
import JQOLog from "./JQOLoog.js";
import QueueWorker from "./jobWorkers/classJobWorker.js";
import threadBoot from "../../helpers/threadBoot.js";
import { redisCache } from "../../helpers/redis/connectRedis.js";

await threadBoot(true);

const key = "JobQueue";

const QueueWorker1 = new QueueWorker("QueueWorker1");
const QueueWorker2 = new QueueWorker("QueueWorker2");

let draining = false;
const subClone = redisCache.duplicate();
await subClone.connect();
await subClone.pSubscribe(`__keyspace@0__:${key}`, async (event, channel) => {
    if (!event.includes("push") || draining) return;
    draining = true;

    //start the job queueing

    try {
        while ((await getJobQueueSize()) !== 0) {
            // run till queue is drained
            //get curent job
            const currentJobInfo = (await getJobQueueEntries()).shift();
            await deleteJobQueueEntry(currentJobInfo);
            if (!currentJobInfo) {
                JQOLog.warn("There's a falsy job:" + currentJobInfo);
                continue;
            }
    
            const { type, data } = currentJobInfo;
    
            if (type === "retrieveCharacter") {
                await QueueWorker1.retrieveCharacter(data);
            } else if (type === "bulkRetrieveCharacter") {
                if (!Array.isArray(data)) {
                    JQOLog.error("For bulkRetrieveCharacter job type the data has to be an array");
                    continue;
                }
                if (data.length <= 2) {
                    for (const jobData of data) await QueueWorker2.retrieveCharacter(jobData);
                    continue;
    
                }
    
                for (let i = 0; i < data.length; i++) {
                    const jobData = data[i];
                    if (i <= Math.floor(data.length / 2)) {
                        await QueueWorker1.retrieveCharacter(jobData);
                    } else {
                        await QueueWorker2.retrieveCharacter(jobData);
                    }
                }
            }
        }

    } finally {
        draining = false;
    }
});

JQOLog.info("BOOTED");
// Hello buddy how're ya doing?
