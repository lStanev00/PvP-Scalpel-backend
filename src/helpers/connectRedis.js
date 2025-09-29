import { createClient } from "redis";
import dotenv from 'dotenv';


export default async function connectRedis() {
    const isLocal = process.env.REDIS_PUBLIC_URL;
    let url = `redis://default:${process.env.REDISPASSWORD}@${process.env.REDISHOST}:${process.env.REDISPORT}`;
    if (isLocal !== undefined) {
        url = isLocal;
    }
    let client = createClient({
        url: url
    });

    if(isLocal)

    await client.connect();

    const tryout = new Map();
    await client.set("mapTest", JSON.stringify(tryout));

    const value = await client.get("mapTest");

    console.info("Redis get try == " + value);


}