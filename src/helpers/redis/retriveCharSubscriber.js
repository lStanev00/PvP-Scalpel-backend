import { CharCacheEmitter } from "../../caching/characters/charCache.js";
import { redisCache } from "./connectRedis.js";

export async function registerCharCacheEventListener(silent = false) {
    const redisDubPub = redisCache.duplicate();
    await redisDubPub.connect();
    redisDubPub.subscribe("job:retrieveCharacter", async (data) => {
        CharCacheEmitter.emit("retrieveCharacter", JSON.parse(data));
    });
    if (!silent) console.info(`redis sub connected`);
    
}