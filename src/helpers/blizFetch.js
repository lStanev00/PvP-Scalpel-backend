import dotenv from 'dotenv';
import helpFetch from './blizFetch-helpers/endpointFetchesBliz.js';
import dataGuard from './blizFetch-helpers/dataGuard.js';
// import { performance } from 'perf_hooks';

dotenv.config({ path: '../../.env' });

async function fetchData(server, realm, name, checkedCount = undefined) {
    // const start = performance.now();
    name = name.toLowerCase();

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
                slug: data.realm.slug
            },
            blizID: data.id,
            level: Number(data.level),
            faction: data.faction.name,
            lastLogin: data.last_login_timestamp,
            achieves: { points: Number(data.achievement_points) },
            class: { name: data.character_class.name },
            race: data.race.name,
            activeSpec: { name: data.active_spec.name },
            guildMember: false,
        };
        const guard = await dataGuard(result);
        if(guard === 304) return 304;
        if (data?.guild?.name == "PvP Scalpel") {
            result.guildMember = true;

        } else {
            result.guildMember - false;
        }
        result.guildName = data?.guild?.name;
        // Fetch dependent data in parallel
        const [
            classMedia,
            activeSpecMedia,
            rating,
            rating2v2Record,
            rating3v3Record,
            achievements,
            media,
            gear,
            equipmentStats
        ] = await Promise.all([
            helpFetch.getMedia(data, 'character_class'),
            helpFetch.getMedia(data, 'active_spec'),
            helpFetch.getRating(data.pvp_summary.href, currentSeasonIndex),
            helpFetch.getAchievById(data.achievements_statistics.href, 370),
            helpFetch.getAchievById(data.achievements_statistics.href, 595),
            helpFetch.getAchievXP(data.achievements.href, result.achieves),
            helpFetch.getCharMedia(data.media.href),
            helpFetch.getCharGear(data.equipment.href),
            helpFetch.getStats(data.statistics.href)
        ]);
        // Assign fetched values to result
        result.class.media = classMedia;
        result.activeSpec.media = activeSpecMedia;
        result.rating = rating;
        if (!result.rating["3v3"]) result.rating["3v3"] = {record: null}
        if (!result.rating["3v3"].record) result.rating["3v3"].record = null;
        if (!result.rating["2v2"]) result.rating["2v2"] = {record: null}
        if (!result.rating["2v2"].record) result.rating["2v2"].record = null;
        result.rating["2v2"].record = rating2v2Record;
        result.rating["3v3"].record = rating3v3Record;
        result.achieves = achievements[0];
        result.listAchievements = achievements[1];
        result.media = media;
        result.gear = gear;
        result.equipmentStats = equipmentStats;

        const talent = await helpFetch.getActiveTalentsCode(data.specializations.href);
        result.talents = talent;
        result.search = `${name}:${realm}:${server}`
        if(checkedCount){
            try {
                const checkToNr = Number(checkedCount); 
                if(typeof checkToNr === "number") result.checkedCount = checkToNr;
            } catch (error) {
                console.warn(error)
            }
        } 

        // const end = performance.now(); 
        // console.log(`Elapsed: ${end - start} ms`);
        return result;
    } catch (error) {
        console.log(error)
        return false
    }
}
export default fetchData
// Example usage
// fetchData(`eu`, `chamber-of-aspects`, `Jinada`)