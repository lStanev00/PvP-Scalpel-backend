import { delay, startBackgroundTask } from "../helpers/startBGTask.js";
import { updateGuildMembersData } from "./PatchGuildMembersData.js";
import updateDBAchieves from "./updateAchieves.js";
import updateDBRealms from "./updateRealms.js";
import { fork } from "node:child_process";

export default async function startServices() {
    const clearenceMS = 3000;
    let warmupFinished = false;

    // await initialCache();
    const cacheWormupTask = fork("src/workers/initialChace/workerInitialCache.js");

    cacheWormupTask.on("exit",() => {
        warmupFinished=true;
    });

    while (warmupFinished !== true) await delay(clearenceMS);

    console.info("[Cache] Initial cache finished.");
    
    startBackgroundTask(updateDBRealms, 2147483647); // max 24.8 days
    await delay(clearenceMS);
    startBackgroundTask(updateGuildMembersData, 3600000) // 1 hr
    await delay(clearenceMS);
    startBackgroundTask(updateDBAchieves, 604800000) // 1 week

}