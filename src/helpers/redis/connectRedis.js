import { createClient } from "redis";
import { configDotenv } from "dotenv";
import dns from "dns";
import { delay } from "../startBGTask.js";

configDotenv();

const IS_LOCAL = process.env.IS_LOCAL;
const url = IS_LOCAL
    ? process.env.REDIS_URL
    : `redis://default:${process.env.REDIS_PASSWORD}@redis:${process.env.REDISPORT}`;

const socketOptions = {
    family: IS_LOCAL ? 4 : 6,
    dnsLookup: (hostname, opts, cb) =>
        dns.lookup(hostname, { family: IS_LOCAL ? 4 : 6 }, cb),
};

// main (DB 0) client
export const redisCache = createClient({ url, socket: socketOptions });

// secondary (DB 1) client for characters
export const redisCacheCharacters = createClient({ url, socket: socketOptions });

export default async function connectRedis(silent = false) {
    let iter = 0;
    
    while (true) {
        if (iter > 0) await delay(5000);
        try {
            // Connect both clients
            await Promise.all([
                redisCache.connect(),
                redisCacheCharacters.connect(),
            ]);
    
            // Select databases
            await redisCache.select(0);
            await redisCacheCharacters.select(1);
    
            // Enable only expiration notifications for DB1
            await redisCacheCharacters.configSet("notify-keyspace-events", "Ex");
    
            if (!silent) console.info("Redis connected: DB0 + DB1 ready!");
            break;
        } catch (error) {
            console.warn("Redis failed to connect!\n    => The iter == " + iter);
            iter += 1;
            // console.error(error);
            // process.exit(1);
        }
        
    }
}

// DB selector helper
export function getRedisClient(dbIndex = 0) {
    return dbIndex === 1 ? redisCacheCharacters : redisCache;
}
