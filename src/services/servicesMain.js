// import { delay } from "../helpers/startBGTask.js";
import { redisCache } from "../helpers/redis/connectRedis.js";
import JobQueue from "../workers/jobQueue/jobQueue.js";
import workerPatchGuildMembersData from "../workers/PatchGuildMembersData/workerPatchGuildMembersData.js";
import workerupdateDBAchieves from "../workers/updateDBAchievements/workerUDBA.js";
import workerUpdateRealm from "../workers/updateRealm/workerUpdateRealm.js";

const jobQueue = new JobQueue();
const LEGACY_CHARACTER_CACHE_DATABASE = 1;

async function dropLegacyDb1IfRequested() {
    if (process.env.SHOULD_DROP_DB1 !== "true") return;

    const legacyDbClient = redisCache.duplicate();

    try {
        if (!legacyDbClient.isOpen) {
            await legacyDbClient.connect();
        }

        await legacyDbClient.select(LEGACY_CHARACTER_CACHE_DATABASE);
        await legacyDbClient.flushDb();

        console.info("[Redis] Legacy DB1 dropped because SHOULD_DROP_DB1=true.");
    } catch (error) {
        console.error("[Redis] Failed to drop legacy DB1:", error);
    } finally {
        try {
            if (legacyDbClient.isOpen) {
                await legacyDbClient.quit();
            }
        } catch (error) {
            console.error("[Redis] Failed to close legacy DB1 cleanup client:", error);
        }
    }
}

export default async function startServices() {
    // fork("src/workers/jobQueue/jobQueueOrchestrator.js");
    await dropLegacyDb1IfRequested();
    await jobQueue.initialize();
    
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
