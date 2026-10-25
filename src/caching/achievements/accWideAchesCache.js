import { randomUUID } from "node:crypto";
import delCache from "../../helpers/redis/deletersRedis.js";
import getCache from "../../helpers/redis/getterRedis.js";
import setCache from "../../helpers/redis/setterRedis.js";
import AccWideAches from "../../Models/AccWideAches.js";
import { redisCache } from "../../helpers/redis/connectRedis.js";

const hashName = "acc_wide_aches";
const printIt = (text) => "[Account Wide Achievements]" + " " + text;

export const ACWACache = {
    loadCache : async () => {
        const tempHash = `${hashName}:temp:${randomUUID()}`;
        const list = await AccWideAches.find();

        await delCache(hashName); // drop 1st

        const ops = []
        for (const ach of list) {
            ops.push(setCache(ach._id, ach, tempHash))
        }

        await Promise.all(ops);
        await redisCache.rename(tempHash, hashName);
        
        console.info(printIt("Just warmed the cache"))
    },
    getByID: async (id) => await getCache(id, hashName)

}