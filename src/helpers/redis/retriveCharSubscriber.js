import { CharCacheEmitter } from "../../caching/characters/charCache.js";
import { redisCache } from "./connectRedis.js";

let subscriber = undefined;
let started = false;

export async function registerCharCacheEventListener(silent = false) {
    if (started) {
        return subscriber;
    }

    subscriber = redisCache.duplicate();
    await subscriber.connect();
    await subscriber.subscribe("job:retrieveCharacter", async (data) => {
        const payload = JSON.parse(data);
        if (!payload?.search) return;

        CharCacheEmitter.emit(`retrieveCharacter:${payload.search}`, payload);
    });
    started = true;

    if (!silent) console.info(`[CharCacheEventListener] subed`);

    return subscriber;
}
