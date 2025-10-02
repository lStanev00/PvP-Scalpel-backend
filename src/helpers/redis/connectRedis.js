import { createClient } from "redis";
import { configDotenv } from "dotenv";
configDotenv()

const isLocal = process.env.REDIS_LOCAL_URL;
// let url = `redis://default:${process.env.REDISPASSWORD}@${process.env.REDISHOST}:${process.env.REDISPORT}`;
let url = process.env.REDIS_URL;

if (isLocal !== undefined) {
    url = isLocal;
}
export const redisCache = createClient({
    url: url
});

export default async function connectRedis(silent = false) {
    if(isLocal)

    try {
        await redisCache.connect();
        if (silent === false) console.info("Redis Connected Successfully!");
        
    } catch (error) {
        console.warn("Redis failed to Connect!");
        console.error(error);
        process.exit(1);
    }
}