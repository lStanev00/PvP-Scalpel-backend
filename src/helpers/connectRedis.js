import { Types } from "mongoose";
import { createClient } from "redis";
import { sanitizeValue } from "../middlewares/sanitizer";

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

    await redisCache.connect();

    const tryout = new Map();
    await redisCache.set("mapTest", JSON.stringify(tryout));

    const value = await dockCache()

    console.info("Redis get try == " + value);

}

// Upload an entry to Redis
export async function shipCache(key, value) {
    try {
        try {
            key = await checkKey();
        } catch (error) {
            console.warn(error)
            return null;
        }

        const serializedValue = JSON.stringify(value);

        const success = await redisCache.set(key, serializedValue).catch(console.info(`Redis Bug`));
        if(!success) console.warn(success);

        return success;
        
    } catch (error) {
        console.warn(error);
    }
}

// Get an entry to Redis
export async function dockCache(key) {

    try {
        key = await checkKey();
    } catch (error) {
        console.warn(error)
        return null;
    }

    let result = await redisCache.get(key).catch(console.info("Redis Cache bug"));
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
export default function checkKey(key) {
        
    if(key instanceof Types.ObjectId || typeof key === "number") key = key.toString();

    if (key.length > 24) throw new Error("The key character length's too long\n Must be within 24 characters");

    if (typeof key !== "string") throw new TypeError(`The type of: ${sanitizeValue(key)} is not a valid type!`);

    return key;
}