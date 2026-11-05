import mongoose from "mongoose";
import { getCharacter } from "../../caching/characters/charCache.js";
import Warbands from "../../Models/Warbands.js";
import threadBoot from "../../helpers/threadBoot.js";
import { delay } from "../../helpers/startBGTask.js";
import { redisCache, redisCharacterCacheTTL, redisQueueClaimTTL } from "../../helpers/redis/connectRedis.js";
import { registerCharCacheEventListener } from "../../helpers/redis/retriveCharSubscriber.js";

let subscriber;
let shuttingDown = false;

async function shutdown(code) {
    if (shuttingDown) return;
    shuttingDown = true;
    await Promise.allSettled([
        mongoose.disconnect(),
        ...[subscriber, redisCache, redisCharacterCacheTTL, redisQueueClaimTTL]
            .filter(client => client?.isOpen)
            .map(client => client.quit()),
    ]);
    process.exit(code);
}

process.once("disconnect", () => { void shutdown(1); });
process.once("SIGTERM", () => { void shutdown(0); });

process.on("message", async message => {
    if (message.type === "stop") {
        await shutdown(0);
        return;
    }
    if (message.type !== "batch") return;

    try {
        await Promise.all(message.batch.map(async ({ name, playerRealm, server, blizID }) => {
            try {
                const fetchedChar = await getCharacter(server, playerRealm.slug, name, false, true, true);
                const lookupId = Number(fetchedChar?.blizID ?? blizID);
                const assigned = await Warbands.exists({ characters: lookupId });
                if (assigned) {
                    console.info(`[PID ${process.pid}] Char just wbed ${name} (${lookupId}) -> ${assigned._id}`);
                } else {
                    console.warn(`[PID ${process.pid}] Warband still missing for ${name}:${playerRealm.slug}:${server}`, {
                        blizID: lookupId,
                        foundCharacter: Boolean(fetchedChar?.blizID),
                        resultCode: fetchedChar === 404 ? 404 : fetchedChar?.code,
                    });
                }
            } catch (error) {
                console.warn(`[PID ${process.pid}] Warband refresh failed for ${name}:${playerRealm.slug}:${server}`, error);
                await delay(1000);
            }
        }));
        if (process.connected) process.send({ type: "batchComplete" });
    } catch (error) {
        if (process.connected) process.send({ type: "error", error: error.stack ?? String(error) });
        await shutdown(1);
    }
});

await threadBoot(true);
subscriber = await registerCharCacheEventListener(true);
if (process.connected) process.send({ type: "ready" });
