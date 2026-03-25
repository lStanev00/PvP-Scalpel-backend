import { exit } from 'node:process';
import setCache from "../../../helpers/redis/setterRedis.js";
import connectRedis, { redisCache } from "../../../helpers/redis/connectRedis.js";

const hashName = "CharSearch";

async function loadCache(data) {
    try {
        for (const entry of data) {
            await setCache(entry._id, entry, hashName);
        }
        return true;
    } catch (error) {
        console.error(error);
        return false;
    }
}

process.once("message", async (data) => {
    try {
        await connectRedis(true);
        const result = await loadCache(data);
        const exist = result ? 0 : 1;

        if (typeof process.send === "function") {
            process.send(result ? "done" : "failed");
        }

        await redisCache.quit();
        exit(exist);
    } catch (error) {
        console.error(error);
        await redisCache.quit().catch(() => null);
        exit(1);
    }
});
