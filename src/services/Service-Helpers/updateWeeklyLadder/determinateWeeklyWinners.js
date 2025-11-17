import { purgeWeeklyCache } from "../../../caching/weeklyChamps/weeklyChampsCache.js";
import Char from "../../../Models/Chars.js";
import charWeeklySnapshot from "../../../Models/CharWeeklySnaphsot.js";
import WeeklyWinnersRecord from "../../../Models/WeeklyWinnersRecord.js";
import { buildSnapshots } from "./buildSnapshots.js";
import formatWeeklyData from "./formatWeeklyData.js";
/**
 * @returns {Promise<boolean>}
 */
export default async function determinateWeeklyWinners() {

    try {
        const guildCharList = await Char.find({ guildMember: true });
        const data = await formatWeeklyData(guildCharList);
        if (!data) return false;

        const exist = await charWeeklySnapshot.find().lean();
        if (exist.length !== 0) {
            await charWeeklySnapshot.collection.drop().catch((err) => {
                if (err.code !== 26) throw err; // code 26 = "NamespaceNotFound"
            });
            await purgeWeeklyCache();
        }
    
        await WeeklyWinnersRecord.create(data);
    
        const newWeeklySnapshotDocs = await buildSnapshots()
        return true
        
    } catch (error) {
        console.error(error);
        return false
    }
    
}
