import dotenv from 'dotenv';
import helpFetch from './blizFetch-helpers/endpointFetchesBliz.js'
dotenv.config({ path: '../../.env' });

const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;

async function fetchData(server, realm, name) {
    name = name.toLowerCase();
    const result = {};
    let accessToken = await helpFetch.getAccessToken(clientId, clientSecret);

    const headers = {
        headers: {
          Authorization: `Bearer ${accessToken}`, 
          'Cache-Control': 'no-cache',  
          'Pragma': 'no-cache',
        },
    }

    try {
        // Fetch the main character profile
        let data = await helpFetch.getCharProfile(server, realm, name, headers);
        if (!data || !data.id) return false;

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
            activeSpec: { name: data.active_spec.name }
        };

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
            helpFetch.getMedia(data, 'character_class', headers),
            helpFetch.getMedia(data, 'active_spec', headers),
            helpFetch.getRating(data.pvp_summary.href, headers, server, result.name),
            helpFetch.getAchievById(data.achievements_statistics.href, headers, 370),
            helpFetch.getAchievById(data.achievements_statistics.href, headers, 595),
            helpFetch.getAchievXP(data.achievements.href, headers, result.achieves),
            helpFetch.getCharMedia(data.media.href, headers),
            helpFetch.getCharGear(data.equipment.href, headers),
            helpFetch.getStats(data.statistics.href, headers)
        ]);

        // Assign fetched values to result
        result.class.media = classMedia;
        result.activeSpec.media = activeSpecMedia;
        result.rating = rating;
        if (!result.rating["3v3"]) result.rating["3v3"] = {record: 0}
        if (!result.rating["3v3"].record) result.rating["3v3"].record = 0;
        if (!result.rating["2v2"]) result.rating["2v2"] = {record: 0}
        if (!result.rating["2v2"].record) result.rating["2v2"].record = 0;
        result.rating["2v2"].record = rating2v2Record;
        result.rating["3v3"].record = rating3v3Record;
        result.achieves = achievements;
        result.media = media;
        result.gear = gear;
        result.equipmentStats = equipmentStats;

        return result;
    } catch (error) {
        console.log(error)
        return false
    }
}
export default fetchData
// Example usage
// fetchData(`eu`, `chamber-of-aspects`, `Lychezar`)