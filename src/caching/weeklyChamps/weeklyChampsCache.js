import delCache from "../../helpers/redis/deletersRedis.js";
import getCache from "../../helpers/redis/getterRedis.js";
import setCache from "../../helpers/redis/setterRedis.js";
import formatWeeklyData from "../../services/Service-Helpers/updateWeeklyLadder/formatWeeklyData.js";
import { EventEmitter } from "node:events";

const emitter = new EventEmitter();
const hashName = "weeklyChampsCache";

emitter.on("update", (msg) => console.log(`[${hashName} UPDATE] ${msg}`));
emitter.on("error", (msg) => console.error(`[${hashName} ERROR] ${msg}`));
emitter.on("info", (msg) => console.info(`[${hashName} INFO] ${msg}`));

export const onRegionIdsUpdate = () =>
    emitter.on("update", console.info("[Regions Cache] Regions just got cached"));

export async function cacheWeeklyData() {
    const data = await formatWeeklyData();

    if (!data) {
        emitter.emit("error", "There's no data comming form the getter function.");
        return;
    }

    await delCache(hashName);

    for (const [bracketName, bracketData] of Object.entries(data)) {
        await setCache(bracketName, bracketData, hashName);
    }

    emitter.emit("update", "Just cached the data");
}

export async function getTop10ForABracket(bracketName) {
    if (
        bracketName !== "shuffle" &&
        bracketName !== "blitz" &&
        bracketName !== "2v2" &&
        bracketName !== "3v3" &&
        bracketName !== "RBG"
    ) {
        emitter.emit("error", `${bracketName} is not an existing bracket.`);
        return;
    }

    const bracketData = await getCache(bracketName, hashName);
    if (!bracketData) return 404;

    const result = bracketData.slice(0, 10);
    return result
}
