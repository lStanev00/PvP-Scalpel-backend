import { createClient } from "redis";
import { configDotenv } from "dotenv";
import dns from "dns";
configDotenv();

const IS_LOCAL = process.env.IS_LOCAL;
const url = IS_LOCAL
    ? process.env.REDIS_URL
    : `redis://default:${process.env.REDIS_PASSWORD}@redis:${process.env.REDISPORT}`;

// helper for DNS family choice
const socketOptions = {
    family: IS_LOCAL ? 4 : 6,
    dnsLookup: (hostname, opts, cb) => {
        dns.lookup(hostname, { family: IS_LOCAL ? 4 : 6 }, cb);
    }
};

// main (DB 0) client
export const redisCache = createClient({ url, socket: socketOptions });

// optional secondary (DB 1) client
export const redisCacheCharacters = createClient({ url, socket: socketOptions });

export async function connectRedis(silent = false) {
    try {
        await Promise.all([
            redisCache.connect(),
            redisCacheCharacters.connect()
        ]);

        // select databases
        await redisCache.select(0); // main cache
        await redisCacheCharacters.select(1); // secondary cache

        if (!silent) console.info("Redis connected: DB0 + DB1 ready!");
    } catch (error) {
        console.warn("Redis failed to connect!");
        console.error(error);
        process.exit(1);
    }
}

// optional helper to choose DB dynamically
export function getRedisClient(dbIndex = 0) {
    if (dbIndex === 1) return redisCacheCharacters;
    return redisCache;
}
