import toMap from "../toMap.js";
import { redisCache } from "./connectRedis.js";
import checkKey from "./validateRedisKey.js";

export default async function hasHashCache(hash, key) {
    if(!hash || !key) throw new Error("Invalid input!");
    if (typeof hash !== "string") throw new TypeError(`${typeof hash} is not a string!`);

    key = checkKey(key);
    if(typeof key !== "string") throw new TypeError("Invalid key");

    const data = await redisCache.hGetAll(hash);
    const cacheMap = toMap(data);

    const exist = cacheMap.has(key);
    return exist;
}