import delCache from "../../helpers/redis/deletersRedis.js";
import getCache from "../../helpers/redis/getterRedis.js";
import setCache from "../../helpers/redis/setterRedis.js";
import formatWeeklyData from "../../services/Service-Helpers/updateWeeklyLadder/formatWeeklyData.js";
import { EventEmitter } from "node:events";

export const WeeklyEmitter = new EventEmitter();
const hashName = "weeklyChampsCache";
const humanReadableName = "Weekly"

WeeklyEmitter.on("update", (msg) => console.log(`[${humanReadableName}] ${msg}`));
WeeklyEmitter.on("error", (msg) => console.error(`[${humanReadableName} ERROR] ${msg}`));
WeeklyEmitter.on("info", (msg) => console.info(`[${humanReadableName} INFO] ${msg}`));

export async function cacheWeeklyData(data = undefined) {
    if (!data) data = await formatWeeklyData();

    if (!data) {
        WeeklyEmitter.emit("error", "There's no data comming form the getter function.");
        return;
    }

    await delCache(hashName);

    for (const [bracketName, bracketData] of Object.entries(data)) {
        await setCache(bracketName, bracketData, hashName);
    }

    await setCache("lastUpdated", Date.now(), hashName); // set the last updated timestamp 

    WeeklyEmitter.emit("update", "Just cached the data for all brackets");
}

export async function getTop10ForABracket(bracketName) {
    if (
        bracketName !== "shuffle" &&
        bracketName !== "blitz" &&
        bracketName !== "2v2" &&
        bracketName !== "3v3" &&
        bracketName !== "RBG"
    ) {
        WeeklyEmitter.emit("error", `${bracketName} is not an existing bracket.`);
        return;
    }

    const bracketData = await getCache(bracketName, hashName);
    const lastUpdated = await getCache("lastUpdated", hashName);
    if (!bracketData) return 404;

    const result = {
        data: bracketData.slice(0,10),
        lastUpdated
    }

    return result
}
