import { Types } from "mongoose";
import { createClient } from "redis";
import { sanitizeValue } from "../middlewares/sanitizer.js";

const isLocal = process.env.REDIS_PUBLIC_URL;
let url = `redis://default:${process.env.REDISPASSWORD}@${process.env.REDISHOST}:${process.env.REDISPORT}`;

if (isLocal !== undefined) {
    url = isLocal;
}
const redisCache = createClient({
    url: url
});

export default async function connectRedis() {
    if(isLocal)

    try {
        await redisCache.connect();
        console.info("Redis Connected Successfully!");
        
    } catch (error) {
        console.warn("Redis failed to Connect!");
        console.error(error);
    }
}

// Upload an entry to Redis
export async function shipCache(key, value) {
    try {
        try {
            key = checkKey(key);
        } catch (error) {
            console.warn(error)
            return null;
        }

        const serializedValue = JSON.stringify(value);

        const success = await redisCache.set(key, serializedValue).catch((reason)=> console.info(`Redis Bug reason: ` + reason));
        if(!success) console.warn(success);

        return success;
        
    } catch (error) {
        console.warn(error);
    }
}

// Get an entry from Redis
export async function dockCache(key) {

    try {
        key = checkKey(key);
    } catch (error) {
        console.warn(error)
        return null;
    }

    let result = await redisCache.get(key).catch((reason)=> console.info(`Redis Bug reason: ` + reason));
    if(!result) {
        console.warn(result)
    } else {
        try {
            
            result = JSON.parse(result);
            return result;

        } catch (error) {
            console.warn(error);
            return result;
        }
    }

}

// Validate Key
export function checkKey(key) {

    if(!key) throw new Error("You must provide a key");
        
    if(key instanceof Types.ObjectId || typeof key === "number") key = key.toString();

    if (key.length > 24) throw new Error("The key character length's too long\n Must be within 24 characters");

    if (typeof key !== "string") throw new TypeError(`The type of: ${sanitizeValue(key)} is not a valid type!`);

    return key;

}