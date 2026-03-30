import { DBconnect } from "./mongoHelper.js";
import connectRedis from "./redis/connectRedis.js";
import { registerCharCacheEventListener } from "./redis/retriveCharSubscriber.js";

/**
 * Thread and worker bootstrap helpers.
 *
 * This module centralizes shared startup logic for child-process and worker
 * entry points.
 */
/**
 * Boots shared thread-level dependencies.
 *
 * The implementation currently initializes Redis connectivity for worker and
 * child-process entry points.
 *
 * @param {boolean} [silent=false] When `true`, suppresses non-critical startup logs.
 * @returns {Promise<void>}
 */
export default async function threadBoot(silent = false) {
    await connectRedis(silent);
    await DBconnect(silent);
    await registerCharCacheEventListener(silent);
}
