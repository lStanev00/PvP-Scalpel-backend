import Char from "../../Models/Chars.js";
import { redisCacheCharacters } from "./connectRedis.js";
import delCache from "./deletersRedis.js";
import getCache from "./getterRedis.js";

const subscriber = redisCacheCharacters.duplicate();

export default async function startRedisCharSubscriber() {
    try {
        await subscriber.connect();

        await subscriber.subscribe("__keyevent@1__:expired", async (key) => {
            if (!key?.startsWith("EXPIRE:")) return;

            console.info(`[Redis:DB1] Key expired → ${key}`);

            const keyToLook = key.slice("EXPIRE:".length);
            const data = await getCache(keyToLook, "", 1);

            if (!data) {
                console.warn(`[Redis:DB1] No cache found for ${keyToLook}`);
                return;
            }

            const id = data?.id || data?._id;
            let cachedCheckedCount = data?.checkedCount;

            if (!id || typeof cachedCheckedCount === "undefined") {
                console.warn(
                    `[Redis:DB1] Invalid data for ${keyToLook}\n` +
                        `→ id: ${id}\n→ checkedCount: ${cachedCheckedCount}`
                );
                return;
            }

            cachedCheckedCount = Number(cachedCheckedCount);

            try {
                const result = await Char.findByIdAndUpdate(
                    id,
                    { $set: { checkedCount: cachedCheckedCount } },
                    { timestamps: false }
                );

                if (!result) {
                    console.warn(`[Redis:DB1] No Mongo entry found for ${id}`);
                } else {
                    await delCache(keyToLook, "", 1);
                    console.info(`[Redis:DB1] Synced Mongo checkedCount for ${keyToLook}`);
                }
            } catch (error) {
                console.error(`[Redis:DB1] Mongo update failed for ${keyToLook}:`, error);
            }
        });

        console.info("[Redis:DB1] Subscriber active and listening for expirations.");
    } catch (error) {
        console.error("[Redis Subscriber Error]", error);
    }
}
