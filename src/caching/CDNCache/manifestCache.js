import { EventEmitter } from "events";
import getCache from "../../helpers/redis/getterRedis.js";
import setCache from "../../helpers/redis/setterRedis.js";
import pullManifest from "./CDN/pullManifest.js";

const key = "cdn:manifest";

const emitter = new EventEmitter();
emitter.on("update", () => console.info(`[${key} Cache] ${key} just got cached`));

/**
 * Prime the manifest cache on startup.
 * @returns {Promise<unknown|null>} Cached manifest or null on failure.
 */
export const initialSetManifestIdsMap = async () => await storeNewManifest();

/**
 * Retrieve the manifest from cache or fetch and cache it when missing.
 * @returns {Promise<unknown|undefined>} Cached manifest or undefined when unavailable.
 */
export async function getManifest() {
    try {
        const cachedManifest = await getCache(key);
        if (cachedManifest !== null || (cachedManifest !== undefined && cachedManifest))
            return cachedManifest;

        const manifest = await storeNewManifest();
        if (manifest !== null) return manifest;
    } catch (error) {}
}

/**
 * Fetch the latest manifest and store it in cache.
 * @returns {Promise<unknown|null|undefined>} Cached manifest, null on invalid fetch, or undefined on error.
 */
export async function storeNewManifest() {
    try {
        const manifest = await pullManifest();

        if (manifest !== null) {
            await setCache(key, manifest, "", 60);
            emitter.emit("update");
            return manifest;
        }

        console.warn(
            "There was a problem caching the manifest ===" +
                manifest +
                " \nType: " +
                typeof manifest
        );
        return null;
    } catch (error) {
        console.error(error);
    }
}
