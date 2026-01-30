import { delay } from "../helpers/startBGTask.js";
import { initialCharSearchMap } from "./searchCache/charSearchCache.js";
import { initialSetSeasonalIdsMap } from "./achievements/achievesEmt.js";
import { initialSetRealmIdsMap } from "./realms/realmCache.js";
import { initialSetRegionIdsMap } from "./regions/regionCache.js";
import { initialRealmSearchMap } from "./searchCache/realmSearchCach.js";
import updateDBAchieves from "../services/updateAchieves.js";
import updateGameClassAndSpecs from "../services/updateGameClassAndSpecs.js";

export default async function initialCache() {

    try {
        await updateGameClassAndSpecs();
        await updateDBAchieves(); 
        await initialSetRegionIdsMap()
        await initialSetRealmIdsMap();
        await initialSetSeasonalIdsMap();
        await initialRealmSearchMap()
        await initialCharSearchMap();

        await delay(1000);
        console.info("[Cache] Initial cache finished.");

    } catch (error) {
        console.warn(error);
        console.info("[Cache] Initial cache failed.")
    }

}