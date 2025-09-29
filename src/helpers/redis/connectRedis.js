import { createClient } from "redis";
import { configDotenv } from "dotenv";
configDotenv()

const isLocal = process.env.REDIS_PUBLIC_URL;
let url = `redis://default:${process.env.REDISPASSWORD}@${process.env.REDISHOST}:${process.env.REDISPORT}`;

if (isLocal !== undefined) {
    url = isLocal;
}
export const redisCache = createClient({
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