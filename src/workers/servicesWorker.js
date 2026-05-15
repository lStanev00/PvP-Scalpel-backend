// version: 1.8.13
import { redisCharacterCacheTTL } from "../helpers/redis/connectRedis.js";
import threadBoot from "../helpers/threadBoot.js";
import startServices from "../services/servicesMain.js";

await threadBoot();
await dropCachedCharactersForWorkerStartup();
await startServices();

async function dropCachedCharactersForWorkerStartup() {
    try {
        await redisCharacterCacheTTL.flushDb();
        console.info("[Worker] Character payload cache dropped");
    } catch (error) {
        console.error("[Worker] Failed to drop character payload cache");
        console.error(error);
    }
}

