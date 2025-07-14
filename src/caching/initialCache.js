import { delay } from "../helpers/startBGTask.js";
import { initialCharSearchMap } from "./searchCache/charSearchCache.js";
import { initialSetSeasonalIdsMap } from "./achievements/achievesEmt.js";
import { initialSetRealmIdsMap } from "./realms/realmCache.js";
import { initialSetRegionIdsMap } from "./regions/regionCache.js";

export default async function initialCache() {

    try {
        
        await initialSetRegionIdsMap()
        await initialSetRealmIdsMap();
        await initialSetSeasonalIdsMap();
        await initialCharSearchMap();

        await delay(1000);
        // console.info("[Cache] Initial cache finished.");

    } catch (error) {
        console.warn(error);
        console.info("[Cache] Initial cache failed.")
    }

}