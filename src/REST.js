// version: 0.0.77
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


// import { fork } from "node:child_process";
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
// const chars = await Char.find({name: {$regex: "drunk", $options: "i"}}).lean()
// const chars = await Char.find({
//     level: 90,
//     updatedAt: { $lt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) },
// }).populate("warband").lean();
// console.info(chars.length)
// const workerCount = 3;
// const batchSize = 8;
// const pendingChars = chars.filter(({ warband }) => !warband).map(({ name, playerRealm, server, blizID }) => ({
//     name, playerRealm: { slug: playerRealm.slug }, server, blizID,
// }));
// let nextIndex = 0;
// let completed = 0;
// const children = new Set();
// const stopChildren = () => {
//     for (const child of children) child.kill();
// };
// process.once("exit", stopChildren);
// console.info(`${pendingChars.length} characters need warband processing`);
// try {
//     if (pendingChars.length) await Promise.all(Array.from({ length: workerCount }, (_, workerIndex) => new Promise((resolve, reject) => {
//         const child = fork(new URL("./workers/warbandRefresh/workerWarbandRefresh.js", import.meta.url), [], {
//             stdio: ["ignore", "inherit", "inherit", "ipc"],
//             execArgv: process.execArgv.filter(arg => !arg.startsWith("--inspect")),
//         });
//         children.add(child);
//         let stopping = false;
//         let batchLength = 0;
//         const sendNextBatch = () => {
//             const batch = pendingChars.slice(nextIndex, nextIndex + batchSize);
//             nextIndex += batch.length;
//             batchLength = batch.length;
//             stopping = batch.length === 0;
//             child.send({ type: stopping ? "stop" : "batch", batch }, error => {
//                 if (error) reject(error);
//             });
//         };
//         child.on("message", message => {
//             if (message.type === "ready") {
//                 console.info(`[Worker ${workerIndex + 1}] PID ${child.pid} ready`);
//                 sendNextBatch();
//             } else if (message.type === "batchComplete") {
//                 completed += batchLength;
//                 console.info(`[Worker ${workerIndex + 1}, PID ${child.pid}] ${pendingChars.length - completed} chars left`);
//                 sendNextBatch();
//             } else if (message.type === "error") {
//                 reject(new Error(`Warband worker ${child.pid}: ${message.error}`));
//             }
//         });
//         child.once("error", reject);
//         child.once("exit", (code, signal) => {
//             children.delete(child);
//             if (stopping && code === 0) resolve();
//             else reject(new Error(`Warband worker ${child.pid} exited unexpectedly (code ${code}, signal ${signal}).`));
//         });
//     })));
// } catch (error) {
//     console.error("[Warband refresh] Worker pool failed:", error);
// } finally {
//     stopChildren();
//     process.removeListener("exit", stopChildren);
// }
// const char = await getCharacter("eu", "ravencrest", "Dmforhealz", false, true, true);
// if (char) {
//     for (const {name} of char.warband.members) {
//         console.info(name)
//     }
// }
// debugger
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
