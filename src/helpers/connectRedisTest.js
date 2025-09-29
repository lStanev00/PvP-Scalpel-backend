import { createClient } from "redis";


export default async function connectRedis() {
    const client = createClient({
        url: `redis://${process.env.REDISHOST}:${process.env.REDISPORT}`
    });

    await client.connect();

    await client.set("123", "test");

    const value = await client.get("123");

    console.info("Redis get try == " + value);

    if (value === "test") {
        const val2 = await client.del("123");
        console.info(val2);
    }

}