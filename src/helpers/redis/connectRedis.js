import { createClient } from "redis";
import { configDotenv } from "dotenv";
import dns from "dns";
configDotenv()

// let url = process.env.REDIS_URL;
const IS_LOCAL= process.env.IS_LOCAL;
let url = `redis://default:${process.env.REDIS_PASSWORD}@redis:${process.env.REDISPORT}`
if(IS_LOCAL) url = process.env.REDIS_URL;

export const redisCache = createClient({
    url,
    socket: {
        family: IS_LOCAL ? 4 : 6,   // force IPv6 on production
        dnsLookup: (hostname, opts, cb) => {
            dns.lookup(hostname, { family: IS_LOCAL ? 4 : 6 }, cb);
        }
    }
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