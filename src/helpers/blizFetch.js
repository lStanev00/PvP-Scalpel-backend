import dotenv from "dotenv";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import helpFetch from "./blizFetch-helpers/endpointFetchesBliz.js";
import dataGuard from "./blizFetch-helpers/dataGuard.js";
import buildCharSearch from "./buildCharSearch.js";
import { setHighestRatingRecord } from "./blizFetch-helpers/ratingHelpers.js";
// import { performance } from 'perf_hooks';

dotenv.config({ path: "../../.env" });

async function fetchData(server, realm, name, checkedCount = undefined, forceUpdate = false) {
    // const start = performance.now();

    try {
        // Fetch the main character profile

        let data = await helpFetch.getCharProfile(server, realm, name);
        if (!data || !data.id) return false;

        const currentSeasonIndex = await helpFetch.getCurrentPvPSeasonIndex();
        const result = {
            name: data.name,
            server,
            playerRealm: {
                name: data.realm.name,
                slug: data.realm.slug,
            },
            blizID: data.id,
            level: Number(data.level),
            faction: data.faction.name,
            lastLogin: data.last_login_timestamp,
            achieves: { points: Number(data.achievement_points) },
            // class: { name: data.character_class.name },
            class: data.character_class.id,
            race: data.race.name,
            // activeSpec: { name: data.active_spec.name },
            activeSpec: data.active_spec?.id || null,
            guildName: data?.guild?.name,
            guildMember: data?.guild?.name == "PvP Scalpel" ? true : false,
        };
        const guard = await dataGuard(result, forceUpdate);
        if (guard === 304) {
            return {
                code: guard,
                data: result,
            };
        }

        // Fetch dependent data in parallel
        const [
            // classMedia,
            // activeSpecMedia,
            rating,
            rating2v2Record,
            rating3v3Record,
            achievements,
            media,
            gear,
            equipmentStats,
        ] = await Promise.all([
            // helpFetch.getMedia(data, 'character_class'),
            // helpFetch.getMedia(data, 'active_spec'),
            helpFetch.getRating(data.pvp_summary.href, currentSeasonIndex),
            helpFetch.getAchievById(data.achievements_statistics.href, 370),
            helpFetch.getAchievById(data.achievements_statistics.href, 595),
            helpFetch.getAchievXP(data.achievements.href, result.achieves),
            helpFetch.getCharMedia(data.media.href),
            helpFetch.getCharGear(data.equipment.href),
            helpFetch.getStats(data.statistics.href),
        ]);

        // Assign fetched values to result
        // result.class.media = classMedia;
        // result.activeSpec.media = activeSpecMedia;
        result.rating = rating;
        setHighestRatingRecord(result.rating, "2v2", rating2v2Record);
        setHighestRatingRecord(result.rating, "3v3", rating3v3Record);
        result.achieves = achievements[0];
        result.listAchievements = achievements[1];
        result.media = media;
        result.gear = gear;
        result.equipmentStats = equipmentStats;

        const talent = await helpFetch.getActiveTalentsCode(data.specializations.href);
        result.talents = talent;
        result.search = buildCharSearch({ server, realm, name });
        if (checkedCount) {
            try {
                const checkToNr = Number(checkedCount);
                if (typeof checkToNr === "number") result.checkedCount = checkToNr;
            } catch (error) {
                console.warn(error);
            }
        }

        // const end = performance.now();
        // console.log(`Elapsed: ${end - start} ms`);

        if (guard === 202 || guard === 409) {
            return {
                code: guard,
                data: result,
            };
        }
        return result;
    } catch (error) {
        console.log(error);
        return false;
    }
}
export default fetchData;
// Example usage
// const mecho = fetchData(`eu`, `chamber-of-aspects`, `Jinada`)
// const mecho = await fetchData(`eu`, `ravencrest`, `Swapgodxtwo`, false, true);
// console.info(mecho)

export async function fetchMinimalCharacter(
    server,
    realm,
    name,
    checkedCount = undefined,
    forceUpdate = false,
) {
    try {
        let data = await helpFetch.getCharProfile(server, realm, name);
        if (!data || !data.id) return false;

        const currentSeasonIndex = await helpFetch.getCurrentPvPSeasonIndex();
        const result = {
            name: String(data.name),
            server,
            playerRealm: {
                name: data.realm.name,
                slug: data.realm.slug,
            },
            blizID: Number(data.id),
            level: Number(data.level),
            faction: data.faction.name,
            lastLogin: Number(data.last_login_timestamp),
            achieves: { points: Number(data.achievement_points) },
            // class: { name: data.character_class.name },
            class: data.character_class.id,
            race: data.race.name,
            // activeSpec: { name: data.active_spec.name },
            activeSpec: data.active_spec?.id || null,
            guildName: data?.guild?.name,
            guildMember: data?.guild?.name == "PvP Scalpel" ? true : false,
        };
        const guard = await dataGuard(result, forceUpdate);
        if (guard === 304) {
            return {
                code: guard,
                data: result,
            };
        }

        const [rating, rating2v2Record, rating3v3Record, achievements] = await Promise.all([
            helpFetch.getRating(data.pvp_summary.href, currentSeasonIndex),
            helpFetch.getAchievById(data.achievements_statistics.href, 370),
            helpFetch.getAchievById(data.achievements_statistics.href, 595),
            helpFetch.getAchievXP(data.achievements.href, result.achieves),
        ]);

        result.rating = rating;
        setHighestRatingRecord(result.rating, "2v2", rating2v2Record);
        setHighestRatingRecord(result.rating, "3v3", rating3v3Record);
        result.achieves = achievements[0];
        result.listAchievements = achievements[1];
        result.search = buildCharSearch({ server, realm, name });
        if (checkedCount) {
            try {
                const checkToNr = Number(checkedCount);
                if (typeof checkToNr === "number") result.checkedCount = checkToNr;
            } catch (error) {
                console.warn(error);
            }
        }

        if (guard === 202 || guard === 409) {
            return {
                code: guard,
                data: result,
            };
        }
        return result;
    } catch (error) {
        console.log(error);
        return false;
    }
}

// import threadBoot from "./threadBoot.js";

// await threadBoot()
// // Run directly to compare both helpers: node src/helpers/blizFetch.js
// if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
//     const timings = [];

//     for (const helper of [fetchData, fetchMinimalCharacter]) {
//         const start = performance.now();
//         // Force a full fetch so unchanged character data cannot return early. Gasaiyunoo-Outland
//         const result = await helper("eu", "outland", "Gasaiyunoo", undefined, true);
//         const stop = performance.now();

//         timings.push({
//             helper: helper.name,
//             seconds: ((stop - start) / 1000).toFixed(3),
//             status: result ? "success" : "failed",
//         });
//     }

//     console.info("Timing comparison for Gasaiyunoo:outland:eu");
//     console.table(timings);
// }
