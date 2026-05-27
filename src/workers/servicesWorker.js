// version: 1.8.18
import { rm, writeFile } from "node:fs/promises";
import { redisCharacterCacheTTL } from "../helpers/redis/connectRedis.js";
import threadBoot from "../helpers/threadBoot.js";
import startServices from "../services/servicesMain.js";

const readyFilePath = "/tmp/pvp-scalpel-workers-ready";

await rm(readyFilePath, { force: true });
await threadBoot();
// await dropCachedCharactersForWorkerStartup();
await startServices();
await writeFile(readyFilePath, `${new Date().toISOString()}\n`, "utf8");
console.info("[Worker] Readiness marker written.");

async function dropCachedCharactersForWorkerStartup() {
    try {
        await redisCharacterCacheTTL.flushDb();
        console.info("[Worker] Character payload cache dropped");
    } catch (error) {
        console.error("[Worker] Failed to drop character payload cache");
        console.error(error);
    }
}

