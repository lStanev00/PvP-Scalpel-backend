/**
 * @file Playground for inspecting database entries, trying commands, and testing new methods.
 * Run from the repository root with `npm run playground` to load .env and execute this script.
 */

import threadBoot from "./helpers/threadBoot.js";
import Warbands from "./Models/Warbands.js";

await threadBoot();

const popBands = await Warbands.find({
    "characters.2": { $exists: true },
}).populate({
    path: "members",
    select: "search blizID",
    options: { skipCharacterPopulate: true },
});
let i = 1;
for (const { characters, members } of popBands) {
    const searches = new Map(members.map(({ blizID, search }) => [blizID, search]));
    console.info(`\n┌─ Warband ${String(i++).padStart(3, "0")} · ${characters.length} characters`);
    characters.forEach((id, index) => {
        const branch = index === characters.length - 1 ? "└─" : "├─";
        console.info(`${branch} ${searches.get(id) ?? `Unknown character (${id})`}`);
    });
}
console.info(`\n${popBands.length} warbands shown.`);

process.exit(0)
