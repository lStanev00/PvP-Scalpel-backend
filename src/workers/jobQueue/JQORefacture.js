import {
    deleteJobQueueEntry,
    getJobQueueEntries,
    getJobQueueSize,
} from "../../caching/charQueueCache/jobQueueCache.js";
import JQOLog from "./JQOLoog.js";
import QueueWorker from "./jobWorkers/classJobWorker.js";
import threadBoot from "../../helpers/threadBoot.js";
import { delay } from "../../helpers/startBGTask.js";

await threadBoot(true);

const QueueWorker1 = new QueueWorker("QueueWorker1");
const QueueWorker2 = new QueueWorker("QueueWorker2");

let draining = false;
let currentJobInfo = null;
let stopRequested = false;
JQOLog.info("BOOTED");

process.on("message", (msg) => {
    console.log("received:", msg);

    if (msg === "stop") {
        stopRequested = true;
        void waitForDrainAndExit();
    }
});

startQueue();

async function waitForDrainAndExit() {
    while (draining) {
        await delay(300);
    }

    process.exit(0);
}

async function startQueue() {
    try {
        draining = true;
        while (!stopRequested && (await getJobQueueSize()) !== 0) {
            // run till queue is drained
            //get curent job
            currentJobInfo = (await getJobQueueEntries()).shift();
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
            currentJobInfo = null;
        }
    } finally {
        currentJobInfo = null;
        draining = false;

        const queueSize = await getJobQueueSize();
        if (stopRequested || queueSize === 0) {
            process.exit(0);
        }

        void startQueue();
    }
};

// Hello buddy how're ya doing?
