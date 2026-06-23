// version: 0.0.22
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
import { searchRegionFromMapBySlug } from "./caching/regions/regionCache.js";
import helpFetch from "./helpers/blizFetch-helpers/endpointFetchesBliz.js";
import BracketTops from "./Models/bracketTops/BracketTops.js";

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
// const char = await getCharacter("eu", "chamber-of-aspects", "Lychezar", false, true);
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