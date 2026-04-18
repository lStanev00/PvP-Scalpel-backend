import JobQueue from "../workers/jobQueue/jobQueue.js";
import workerPatchGuildMembersData from "../workers/PatchGuildMembersData/workerPatchGuildMembersData.js";
import workerupdateDBAchieves from "../workers/updateDBAchievements/workerUDBA.js";
import workerUpdateRealm from "../workers/updateRealm/workerUpdateRealm.js";

const jobQueue = new JobQueue();

export default async function startServices() {
    await jobQueue.initialize();

    let warmupFinished = false;
    const cacheWormupTask = fork("src/workers/initialChace/workerInitialCache.js");
    cacheWormupTask.on("exit",() => {
        warmupFinished=true;
    });
    while (warmupFinished !== true) await delay(1000);
    console.info("[Cache] Initial cache warmup finished.");

    workerUpdateRealm();
    workerPatchGuildMembersData();
    workerupdateDBAchieves();

    console.info("[Cache] All workers started.");
}
