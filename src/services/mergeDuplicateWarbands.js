import threadBoot from "../helpers/threadBoot.js";
// import Char from "../Models/Chars.js";
import Warbands from "../Models/Warbands.js";

await threadBoot()
async function mergeDuplicateWBDS() {
    const wbds = await Warbands.find().lean();
    const similarities = [];

    for (let i = 0; i < wbds.length; i++) {
        const wbdA = wbds[i];

        const achMap = new Map();

        for (const ach of wbdA.ACWAches) {
            const id = Number(ach.achId);

            if (!achMap.has(id)) achMap.set(id, new Set());

            achMap.get(id).add(ach.completedAt);
        }

        for (let j = i + 1; j < wbds.length; j++) {
            const wbdB = wbds[j];
            const matchedIds = new Set();

            for (const ach of wbdB.ACWAches) {
                const id = Number(ach.achId);

                if (achMap.get(id)?.has(ach.completedAt)) {
                    matchedIds.add(id);
                }
            }

            if (matchedIds.size >= 230) {
                similarities.push({
                    wbdA: wbdA,
                    wbdB: wbdB,
                    matches: matchedIds.size,
                });
            }
        }
    }
    // console.info(similarities);

    for (const { wbdA, wbdB, matches } of similarities) {
        console.info(wbdA.ACWAches.length - wbdB.ACWAches.length);
        const charBlizIdSet = new Set();
        const mapChars = (charIdArr) => {
            charIdArr.map((id) => {
                const idNr = Number(id);
                charBlizIdSet.add(idNr);
            });
        };
        mapChars(wbdA.characters);
        mapChars(wbdB.characters);
        // console.info(Array.from(charBlizIdSet));
        await Warbands.findByIdAndUpdate(wbdA._id, {characters: Array.from(charBlizIdSet)});
        await Warbands.findByIdAndDelete(wbdB._id);
    }
    return similarities
}
let similarities = await mergeDuplicateWBDS();
while (similarities.length > 0) {
    similarities = await mergeDuplicateWBDS();
}

// const bands = (await Warbands.find())
//     .sort((a, b) => b.characters.length - a.characters.length);
// for (const {characters, _id} of bands) {
//     const build = [];
//     for (const character of characters) {
//         let stringBuilder = "";
//         const char = await Char.findOne({blizID: character});

//         // if (char) stringBuilder += char.search;
//         // if (char.guildMember) stringBuilder += "|" + char.guildInsight.rank;
//         // build.push(stringBuilder);
//     }
//     // console.info(`*****=> Warband: ${_id}\n${build.join("\n")}`)
// }

process.exit(0);