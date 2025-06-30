import { onSeasonalIdsUpdate } from "./achievesEmt.js"; 

let seasonalExistsSet = new Set();

onSeasonalIdsUpdate((newMap) => {
    seasonalExistsSet = new Set(newMap.keys());
    console.info(
        `[seasonalSubscriber] cached ${seasonalExistsSet.size} achievement IDs`
    );
});

export function achievementExists(id) {
    return seasonalExistsSet.has(String(id));
}
