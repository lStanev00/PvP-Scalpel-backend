import formReadableID from "../formReadableID.js";
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

    if(result === null) return null;

    if(!result && result !== null) {
        console.warn(result);
    } else {
        try {
            result = JSON.parse(result);
        } catch (error) {
            console.error(error);
        }
    }

    if(result._id) result._id = formReadableID(result._id)
    if(result.id) result.id = formReadableID(result.id)

    return result

}

export async function hashGetAllCache(hash) {
    if (!hash) throw new Error("Bad input");
    hash = checkKey(hash);
    if (typeof hash !== "string") throw new TypeError("The input must be type of string!");

    const result = await redisCache.hGetAll(hash);
    const parsed = {};

    for (const [key, value] of Object.entries(result)) {
        try {
            parsed[key] = JSON.parse(value);
        } catch {
            parsed[key] = value; // fallback if not JSON
        }
    }

    return parsed;
}
