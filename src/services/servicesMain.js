import { delay } from "../helpers/startBGTask.js";
import workerPatchGuildMembersData from "../workers/PatchGuildMembersData/workerPatchGuildMembersData.js";
import workerupdateDBAchieves from "../workers/updateDBAchievements/workerUDBA.js";
import workerUpdateRealm from "../workers/updateRealm/workerUpdateRealm.js";
import { fork } from "node:child_process";

export default async function startServices() {
    fork("src/workers/jobQueue/jobQueueOrchestrator.js");
    
    // let warmupFinished = false;
    // const cacheWormupTask = fork("src/workers/initialChace/workerInitialCache.js");
    // cacheWormupTask.on("exit",() => {
    //     warmupFinished=true;
    // });
    // while (warmupFinished !== true) await delay(1000);
    // console.info("[Cache] Initial cache warmup finished.");
    
    workerUpdateRealm();
    workerPatchGuildMembersData()
    workerupdateDBAchieves();


    console.info("[Cache] All workers started.");

}