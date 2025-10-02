import { createClient } from "redis";
import { configDotenv } from "dotenv";
configDotenv()

let url = process.env.REDIS_URL;

export const redisCache = createClient({
    url: url
});

export default async function connectRedis(silent = false) {
    try {
        await redisCache.connect();
        if (silent === false) console.info("Redis Connected Successfully!");
        
    } catch (error) {
        console.warn("Redis failed to Connect!");
        console.error(error);
        process.exit(1);
    }
}