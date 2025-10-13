import { delay } from "../../../helpers/startBGTask.js";
import Char from "../../../Models/Chars.js";
import charWeeklySnapshot from "../../../Models/CharWeeklySnaphsot.js";

export async function buildSnapshots(charList = undefined) {
    if (!charList) charList = await Char.find({ guildMember: true }).lean();

    const newSnapshots = [];

    for (const { search, rating } of charList) {
        const newRateMap = formRatings(rating);
        const newentry = new charWeeklySnapshot({
            _id: search,
            ratingSnapshot: newRateMap,
        });
        await newentry.save()
    }

    // Bulk insert all snapshots at once (faster, less DB overhead)
    await charWeeklySnapshot.insertMany(newSnapshots, { ordered: false });
    console.info(`[Snapshot] Created ${newSnapshots.length} weekly entries.`);

    await delay(1000);
    return await charWeeklySnapshot.find().lean();
}

const formRatings = (ratings) => {
    const newRateMap = {
        blitz: [],
        shuffle: [],
        "2v2": 0,
        "3v3": 0,
        RBG: 0,
    };

    for (const [bracketName, value] of Object.entries(ratings)) {
        const rating = value?.currentSeason?.rating ?? 0;
        if(!bracketName || !rating && rating !== 0 || rating === null || bracketName === null) debugger;

        if (bracketName.startsWith("blitz")) {
            newRateMap.blitz.push({bracketName, rating});
        } else if (bracketName.startsWith("shuffle")) {
            newRateMap.shuffle.push({bracketName, rating});
        } else if (bracketName === "rbg") {
            newRateMap["RBG"] = rating;
        } else if (Object.hasOwn(newRateMap, bracketName)) {
            newRateMap[bracketName] = rating;
        }
    }

    return newRateMap;
};
