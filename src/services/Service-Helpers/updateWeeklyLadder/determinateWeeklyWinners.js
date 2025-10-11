import { cacheWeeklyData } from "../../../caching/weeklyChamps/weeklyChampsCache.js";
import Char from "../../../Models/Chars.js";
import charWeeklySnapshot from "../../../Models/CharWeeklySnaphsot.js";
import WeeklyWinnersRecord from "../../../Models/WeeklyWinnersRecord.js";
import formatWeeklyData from "./formatWeeklyData.js";
/**
 * @returns {Promise<void>}
 */
export default async function determinateWeeklyWinners() {
    const guildCharList = await Char.find({ guildMember: true });
    const data = await formatWeeklyData(guildCharList);

    if (await charWeeklySnapshot.collection.exists()) {
        await charWeeklySnapshot.collection.drop().catch((err) => {
            if (err.code !== 26) throw err; // code 26 = "NamespaceNotFound"
        });
    }

    await WeeklyWinnersRecord.create(data);

    const newWeeklySnapshotDocs = [];
    
    for (const { search, rating } of guildCharList) {
        newWeeklySnapshotDocs.push({
            _id: search,
            ratingSnapshot: rating,
        });
    }

    await charWeeklySnapshot.insertMany(newWeeklySnapshotDocs, { ordered: false });
    await cacheWeeklyData(data);
    
}
