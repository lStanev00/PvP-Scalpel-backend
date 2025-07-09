import express from "express";
import dotenv from 'dotenv'; dotenv.config({ path: '../.env' });
import { DBconnect } from "./src/helpers/mongoHelper.js";
import router from "./src/router.js";
import cors from 'cors';
import cookieParser from "cookie-parser";
import { startBackgroundTask } from "./src/helpers/startBGTask.js";
import { updateGuildMembersData } from "./src/services/PatchGuildMembersData.js";
import updateDBAchieves from "./src/services/updateAchieves.js";
import { corsOptions, productionUrl } from "./src/corsSetup.js";

const app = express();
const port = process.env.PORT || 8080;

app.disable("x-powered-by");
app.set('trust proxy', true);

await DBconnect();

app.use(cors(corsOptions));
app.options(/^\/(.*)/, cors(corsOptions)); // enable pre-flight for all routes
app.use(cookieParser());
app.use(express.json({ extended: false }));
app.use(`/`, router);


app.listen(port, console.info(`Server's running at http://localhost:${port} or ${productionUrl}`));

startBackgroundTask(updateGuildMembersData, 3600000);
startBackgroundTask(updateDBAchieves, 604800000); // 1 week
