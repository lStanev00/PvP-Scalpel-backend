// version: 0.0.74
import express from "express";
import dotenv from "dotenv";
dotenv.config({ path: "../.env" });
import router from "./router.js";
import cors from "cors";
import cookieParser from "cookie-parser";
import { corsOptions, productionUrl } from "./corsSetup.js";
import sanitizer from "./middlewares/sanitizer.js";
import compression from "compression";
import { delay } from "./helpers/startBGTask.js";
import threadBoot from "./helpers/threadBoot.js";

const app = express();
const port = process.env.PORT || 8080;

app.disable("x-powered-by");
app.set("trust proxy", true);

await threadBoot();

await delay(500);
app.use(compression());

app.use(cors(corsOptions));
app.options(/^\/(.*)/, cors(corsOptions)); // enable pre-flight for all routes
app.use(cookieParser());
app.use(express.json({ extended: false }));
app.use("/", sanitizer);
app.use(`/`, router);

app.listen(port, console.info(`REST's running at http://localhost:${port} or ${productionUrl}`));


// import { getCharacter } from "./caching/characters/charCache.js";
// import Char from "./Models/Chars.js";
// import mergeDuplicateWBDS from "./helpers/warbands/mergeDuplicateWBDS.js";
// import Warbands from "./Models/Warbands.js";
// import Char from "./Models/Chars.js";
// const result = await Char.updateMany({legacyRetrieved: true}, {legacyRetrieved: false});
// console.log("Matched:", result.matchedCount);
// console.log("Updated:", result.modifiedCount);
// const char = await getCharacter("eu", "chamber-of-aspects", "Scalped", false, true);
// const char = await getCharacter("eu", "doomhammer", "Hellomykitty", false, true);
// const char = await getCharacter("eu", "ravencrest", "Ursite", false, true);
// console.info(char)
// const char = await getCharacter("eu", "dragonblight", "Liatwo", false, true);
// const char = await getCharacter("eu", "kirin-tor", "Arluin", false, true);
// console.info(char);
// const region = await searchRegionFromMapBySlug("eu");
// console.info(region);

// the lines bellow can become a functioning module they are ready as is the result is retrived and stored leaderboards of eu tops 
// const data = await helpFetch.fetchBlizzard("https://eu.api.blizzard.com/data/wow/pvp-season/41/pvp-leaderboard/?namespace=dynamic-eu");
// const ldbList = data?.leaderboards;
// for (const {key} of ldbList) {
//     const {href} = key;
//     const bracketData = await helpFetch.fetchBlizzard(href);

//     await BracketTops.formatBracketTops(bracketData);
// }

// await MediaMeta.updateMany(
//     { likes: { $exists: false } },
//     { $set: { likes: [] } },
// );


// Mass warband test 

// const chars = await Char.find({level: 90}).limit(1000);
// const batch = chars.map(char => {
//     return getCharacter(char.server, char.playerRealm.slug, char.name, false, true)
// });

// const result = [];
// // debugger
// for (let i = 0; i < batch.length; i += 50) {
//     const chunk = batch.slice(i, i + 50);

//     const resolved = await Promise.all(chunk);

//     result.push(...resolved);
// // debugger

// }
// console.info(result.length)

// Deduplicate test

// let similarities = await mergeDuplicateWBDS();
// while (similarities.length > 0) {
//     similarities = await mergeDuplicateWBDS();
// }

// const bands = (await Warbands.find())
//     .sort((a, b) => b.characters.length - a.characters.length);
// for (const {characters, _id} of bands) {
//     const build = [];
//     for (const character of characters) {
//         let stringBuilder = "";
//         const char = await Char.findOne({blizID: character});

//         if (char) stringBuilder += char.search;
//         if (char.guildMember) stringBuilder += "|" + char.guildInsight.rank;
//         build.push(stringBuilder);
//     }
//     console.info(`*****=> Warband: ${_id}\n${build.join("\n")}`)
// }