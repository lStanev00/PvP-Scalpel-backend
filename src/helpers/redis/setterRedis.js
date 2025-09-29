import { redisCache } from "./connectRedis.js";
import checkKey from "./validateRedisKey.js";

// Upload an entry to Redis
export default async function setCache(key, value, hash = "") {
    if (typeof hash !== "string") throw new TypeError("The hash have to be a string!");
    if (!value) throw new TypeError("Invalid value's been passed!");

    try {
        try {
            key = checkKey(key);
        } catch (error) {
            console.warn(error)
            return null;
        }

        if (typeof key !== "string") throw new TypeError("The key have to be a string!");

        const serializedValue = JSON.stringify(value);

        let success;

        if (hash !== "") {
            success = await redisCache.hSet(hash, key, serializedValue).catch((reason)=> console.info(`Redis Bug reason: ` + reason));
        } else {
            success = await redisCache.set(key, serializedValue).catch((reason)=> console.info(`Redis Bug reason: ` + reason));
        }

        if(!success) console.warn(success);

        return success;
        
    } catch (error) {
        console.error(error);
    }
}