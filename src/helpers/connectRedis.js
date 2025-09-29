import { createClient } from "redis";


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

    const value = await redisCache.get("mapTest");

    console.info("Redis get try == " + value);


}