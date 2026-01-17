import { EventEmitter } from "events";
import getCache from "../../helpers/redis/getterRedis.js";
import setCache from "../../helpers/redis/setterRedis.js";
import pullManifest from "./CDN/pullManifest.js";

const key = "cdn:manifest";

const emitter = new EventEmitter();
emitter.on("update", () => console.info(`[${key} Cache] ${key} just got cached`));

export const initialSetManifestIdsMap = async () => await storeNewManifest();

export async function getManifest() {
    try {
        const cachedManifest = await getCache(key);
        if (cachedManifest !== null || (cachedManifest !== undefined && cachedManifest))
            return cachedManifest;

        const manifest = await storeNewManifest();
        if (manifest !== null) return manifest;
    } catch (error) {}
}

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
