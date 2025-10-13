import Char from "../../../Models/Chars.js";
import charWeeklySnapshot from "../../../Models/CharWeeklySnaphsot.js";
import WeeklyWinnersRecord from "../../../Models/WeeklyWinnersRecord.js";
import { buildSnapshots } from "./buildSnapshots.js";
import formatWeeklyData from "./formatWeeklyData.js";
/**
 * @returns {Promise<void>}
 */
export default async function determinateWeeklyWinners() {
    const guildCharList = await Char.find({ guildMember: true });
    const data = await formatWeeklyData(guildCharList);

    const exist = await charWeeklySnapshot.find().lean();
    if (exist.length !== 0) {
        await charWeeklySnapshot.collection.drop().catch((err) => {
            if (err.code !== 26) throw err; // code 26 = "NamespaceNotFound"
        });
    }

    await WeeklyWinnersRecord.create(data);

    const newWeeklySnapshotDocs = await buildSnapshots()
    
}
