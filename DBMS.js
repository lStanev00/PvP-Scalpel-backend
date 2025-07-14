import express from "express";
import dotenv from 'dotenv'; dotenv.config({ path: '../.env' });
import { DBconnect } from "./src/helpers/mongoHelper.js";
import router from "./src/router.js";
import cors from 'cors';
import cookieParser from "cookie-parser";
import { delay, startBackgroundTask } from "./src/helpers/startBGTask.js";
import { updateGuildMembersData } from "./src/services/PatchGuildMembersData.js";
import updateDBAchieves from "./src/services/updateAchieves.js";
import { corsOptions, productionUrl } from "./src/corsSetup.js";
import updateDBRealms from "./src/services/updateRealms.js";
import initialCache from "./src/caching/initialCache.js";
import sanitizer from "./src/middlewares/sanitizer.js";
import compression from "compression";

const app = express();
const port = process.env.PORT || 8080;

app.disable("x-powered-by");
app.set('trust proxy', true);

await DBconnect();

app.use(compression());

app.use(cors(corsOptions));
app.options(/^\/(.*)/, cors(corsOptions)); // enable pre-flight for all routes
app.use(cookieParser());
app.use(express.json({ extended: false }));
app.use("/", sanitizer);
app.use(`/`, router);


app.listen(port, console.info(`Server's running at http://localhost:${port} or ${productionUrl}`));

await initialCache();
startBackgroundTask(updateDBRealms, 2147483647); // max 24.8 days
await delay(3000);
startBackgroundTask(updateGuildMembersData, 3600000); // 1 hr
await delay(3000);
startBackgroundTask(updateDBAchieves, 604800000); // 1 week
