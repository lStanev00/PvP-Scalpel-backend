import { workerData } from "worker_threads";
import { exit } from 'node:process';
import setCache from "../../../helpers/redis/setterRedis.js";
import connectRedis, { redisCache } from "../../../helpers/redis/connectRedis.js";

const hashName = "CharSearch";
await connectRedis(true);

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

const result = await loadCache(workerData);
const exist = result ? 0 : 1;

await redisCache.quit();
exit(exist);
