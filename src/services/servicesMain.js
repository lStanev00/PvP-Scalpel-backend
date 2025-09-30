import initialCache from "../caching/initialCache.js";
import { delay, startBackgroundTask } from "../helpers/startBGTask.js";
import { updateGuildMembersData } from "./PatchGuildMembersData.js";
import updateDBAchieves from "./updateAchieves.js";
import updateDBRealms from "./updateRealms.js";

export default async function startServices() {
    const clearenceMS = 3000;

    await initialCache();
    startBackgroundTask(updateDBRealms, 2147483647); // max 24.8 days
    // await delay(clearenceMS);
    // startBackgroundTask(updateGuildMembersData, 3600000) // 1 hr
    // await delay(clearenceMS);
    // startBackgroundTask(updateDBAchieves, 604800000) // 1 week

}