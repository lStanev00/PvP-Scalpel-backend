import Char from "../../../Models/Chars.js";
import charWeeklySnapshot from "../../../Models/CharWeeklySnaphsot.js";
import WeeklyWinnersRecord from "../../../Models/WeeklyWinnersRecord.js";
/**
 * @returns {Promise<void>}
 */
export default async function determinateWeeklyWinners() {
    const weeklySnapshots = await charWeeklySnapshot.find().lean();
    const guildCharList = await Char.find({ guildMember: true }).lean();
    if (weeklySnapshots.length > 0) {
        const records = {
            blitz: [],
            "2v2": [],
            "3v3": [],
            shuffle: [],
            RBG: [],
        };

        for (const { search, rating } of guildCharList) {
            const snapshotEntry = weeklySnapshots.find(
                (entry) => entry._id.toString() === search
            )?.ratingSnapshot;
            if (!snapshotEntry) continue;

            const ratings = Object.entries(rating);
            const charRecords = {
                blitz: 0,
                "2v2": 0,
                "3v3": 0,
                shuffle: 0,
                RBG: 0,
            };

            for (const [bracket, value] of ratings) {
                const snapBracketData = snapshotEntry[bracket];

                const scoreValue = snapBracketData ? value - snapBracketData : value;

                if (bracket.startsWith("blitz")) {
                    if (charRecords.blitz < scoreValue) charRecords.blitz = scoreValue;
                } else if (bracket.startsWith("shuffle")) {
                    if (charRecords.shuffle < scoreValue) charRecords.shuffle = scoreValue;
                } else {
                    charRecords[bracket] = scoreValue;
                }
            }

            for (const [bracket, value] of Object.entries(charRecords)) {
                if (value === 0) continue;
                records[bracket].push([search, value]);
            }
        }

        for (const [bracket, arr] of Object.entries(records)) {
            records[bracket].sort((a, b) => b[1] - a[1]);
        }

        const formattedRecords = {
            blitz: records.blitz.map(([playerSearch, result]) => ({ playerSearch, result })),
            "2v2": records["2v2"].map(([playerSearch, result]) => ({ playerSearch, result })),
            "3v3": records["3v3"].map(([playerSearch, result]) => ({ playerSearch, result })),
            shuffle: records.shuffle.map(([playerSearch, result]) => ({ playerSearch, result })),
            RBG: records.RBG.map(([playerSearch, result]) => ({ playerSearch, result })),
        };

        if (await charWeeklySnapshot.collection.exists()) {
            await charWeeklySnapshot.collection.drop().catch((err) => {
                if (err.code !== 26) throw err; // code 26 = "NamespaceNotFound"
            });
        }

        await WeeklyWinnersRecord.create(formattedRecords);
    }

    const newWeeklySnapshotDocs = [];

    for (const { search, rating } of guildCharList) {
        newWeeklySnapshotDocs.push({
            _id: search,
            ratingSnapshot: rating,
        });
    }

    await charWeeklySnapshot.insertMany(newWeeklySnapshotDocs, { ordered: false });
}