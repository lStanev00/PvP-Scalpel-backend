import Char from "../../../Models/Chars.js";
import charWeeklySnapshot from "../../../Models/CharWeeklySnaphsot.js";
import { buildSnapshots } from "./buildSnapshots.js";

/**
 * Form the data for the weekly brackets
 * @param {Array<Object>} [guildCharList] - Optional guild character list. If not provided, it will be fetched from the database.
 * @returns {Promise<{
 *  blitz: { playerSearch: string, bracketName: string, startRating: number, result: number }[],
 *  "2v2": { playerSearch: string, bracketName: string, startRating: number, result: number }[],
 *  "3v3": { playerSearch: string, bracketName: string, startRating: number, result: number }[],
 *  shuffle: { playerSearch: string, bracketName: string, startRating: number, result: number }[],
 *  RBG: { playerSearch: string, bracketName: string, startRating: number, result: number }[]
 * }>}
 */

export default async function formatWeeklyData(guildCharList = undefined) {
    let weeklySnapshots = await charWeeklySnapshot.find().lean();
    if (!guildCharList) guildCharList = await Char.find({ guildMember: true }).lean();
    if (weeklySnapshots.length === 0) weeklySnapshots = await buildSnapshots(guildCharList);

    const records = {
        // define the structure of the result
        blitz: [],
        "2v2": [],
        "3v3": [],
        shuffle: [],
        RBG: [],
    };

    for (const { search, rating } of guildCharList) {
        // loop the dbase with existing live chars data since the service start as soon as the patch of the guild mems finish so is a live data
        const snapshotEntry = weeklySnapshots.find(
            (entry) => entry._id.toString() === search
        )?.ratingSnapshot;
        if (!snapshotEntry) continue;

        const charRecords = {
            // define 1 character structure of weekly progess data
            blitz: [],
            shuffle: [],
            "2v2": null,
            "3v3": null,
            RBG: null,
        };

        for (let [bracket, value] of Object.entries(rating)) {
            if (bracket.startsWith("solo")) continue;
            if (bracket === "rbg") bracket = "RBG";
            let snapBracketData; // get the snapshot data

            if (bracket.startsWith("blitz")) {
                snapBracketData = snapshotEntry["blitz"].find(
                    (entry) => entry.bracketName === bracket
                ).rating;
            } else if (bracket.startsWith("shuffle")) {
                snapBracketData = snapshotEntry["shuffle"].find(
                    (entry) => entry.bracketName === bracket
                ).rating;
            } else {
                snapBracketData = snapshotEntry[bracket];
            }

            if (snapBracketData === undefined) snapBracketData = 0;

            const extractedValue = value?.currentSeason?.rating ?? 0;

            const scoreValue = snapBracketData ? extractedValue - snapBracketData : extractedValue; // define the outcome of the week

            let bracketOutcome = [bracket, snapBracketData, scoreValue];

            if (scoreValue === 0) continue; // falsy or 0 data is skiped

            if (bracket.startsWith("blitz")) {
                charRecords.blitz.push(bracketOutcome);
            } else if (bracket.startsWith("shuffle")) {
                charRecords.shuffle.push(bracketOutcome);
            } else {
                bracketOutcome.shift();
                charRecords[bracket] = bracketOutcome;
            }
        }

        if (
            charRecords.blitz.length === 0 &&
            charRecords.shuffle.length === 0 &&
            charRecords["2v2"] === null &&
            charRecords["3v3"] === null &&
            charRecords["RBG"] === null
        )
            continue;

        for (let [bracket, value] of Object.entries(charRecords)) {
            // loop the built records

            if (value === null) continue;
            if ((Array.isArray(value) && value[2] === 0) || value.length === 0) continue;

            if (bracket.startsWith("blitz")) {
                for (const brackVal of value) {
                    records.blitz.push([search, brackVal]);
                }
            } else if (bracket.startsWith("shuffle")) {
                for (const brackVal of value) {
                    records.shuffle.push([search, brackVal]);
                }
            } else {
                try {
                    if (bracket === "rbg") bracket = "RBG";
                    records[bracket].push([search, value]);
                } catch (error) {
                    console.warn(error);
                    console.info(bracket);
                }
            }
        }
    }

    for (const [bracket, arr] of Object.entries(records)) {
        if(bracket === "blitz" || bracket === "shuffle") {
            records[bracket].sort((a, b) => b[1][2] - a[1][2]);
        } else {
            records[bracket].sort((a, b) => b[1][1] - a[1][1]);
        }
    }

    const formattedRecords = {
        blitz: records.blitz.map(([playerSearch, [bracketName, startRating, result]]) => ({
            playerSearch,
            bracketName,
            startRating,
            result,
        })),
        "2v2": records["2v2"].map(([playerSearch, [startRating, result]]) => ({
            playerSearch,
            startRating,
            result,
        })),
        "3v3": records["3v3"].map(([playerSearch, [startRating, result]]) => ({
            playerSearch,
            startRating,
            result,
        })),
        shuffle: records.shuffle.map(([playerSearch, [bracketName, startRating, result]]) => ({
            playerSearch,
            bracketName,
            startRating,
            result,
        })),
        RBG: records.RBG.map(([playerSearch, [startRating, result]]) => ({
            playerSearch,
            startRating,
            result,
        })),
    };
    return formattedRecords;
}
