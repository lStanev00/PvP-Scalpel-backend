// version: 0.0.5
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
import Char from "./Models/Chars.js";
import { getGameSpecializationByID } from "./caching/gameSpecializations/gameSpecializationsCache.js";
import GameSpecialization from "./Models/GameSpecialization.js";
import GameClass from "./Models/GameClass.js";
import findCharFromDatabase from "./helpers/findCharFromDatabase.js";
import { getCharacter } from "./caching/characters/charCache.js";

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
