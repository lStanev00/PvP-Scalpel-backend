import { redisCache } from "./connectRedis.js";
import checkKey from "./validateRedisKey.js";

export default async function getCache(key, hash = "") {

    if (typeof hash !== "string") throw new TypeError("The hash have to be a string!");

    try {
        key = checkKey(key);
    } catch (error) {
        console.warn(error)
        return null;
    }

    if (typeof key !== "string") throw new TypeError("The key have to be a string!");

    let result;

    if (hash !== "") {
        result = await redisCache.hGet(hash, key).catch((reason)=> console.info(`Redis Bug reason: ` + reason));
    } else {
        result = await redisCache.get(key).catch((reason)=> console.info(`Redis Bug reason: ` + reason));
    } 

    if(!result) {
        console.warn(result);
        return null;
    } else {
        try {
            
            result = JSON.parse(result);
            return result;

        } catch (error) {
            console.error(error);
            return result;
        }
    }

}

export async function hashgetAllCache(hash) {
    if (!hash) throw new Error("Bad input");
    hash = checkKey(hash);
    if (typeof hash !== "string") throw new TypeError("The input must be type of string!");

    const result = redisCache.hGetAll(hash);
    return JSON.parse(result);
}