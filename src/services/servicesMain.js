// import { delay } from "../helpers/startBGTask.js";
import { redisCache } from "../helpers/redis/connectRedis.js";
import Char from "../Models/Chars.js";
import JobQueue from "../workers/jobQueue/jobQueue.js";
import workerPatchGuildMembersData from "../workers/PatchGuildMembersData/workerPatchGuildMembersData.js";
import workerupdateDBAchieves from "../workers/updateDBAchievements/workerUDBA.js";
import workerUpdateRealm from "../workers/updateRealm/workerUpdateRealm.js";

const jobQueue = new JobQueue();

async function delegacy() {

    try {
        const result = await Char.updateMany(
            { legacyRetrieved: true },
            { $set: { legacyRetrieved: false } },
            { timestamps: false },
        );

        console.info(`[Services] Reset legacyRetrieved on ${result.modifiedCount ?? 0} characters.`);
    } catch (error) {
        console.warn("[Services] Failed to reset legacyRetrieved flags.");
        console.warn(error);
    }
}

export default async function startServices() {
    await delegacy();
    await jobQueue.initialize();

    // let warmupFinished = false;
    // const cacheWormupTask = fork("src/workers/initialChace/workerInitialCache.js");
    // cacheWormupTask.on("exit",() => {
    //     warmupFinished=true;
    // });
    // while (warmupFinished !== true) await delay(1000);
    // console.info("[Cache] Initial cache warmup finished.");

    workerUpdateRealm();
    workerPatchGuildMembersData();
    workerupdateDBAchieves();

    console.info("[Cache] All workers started.");
}
