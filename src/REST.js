// version: 0.0.3
import express from "express";
import dotenv from 'dotenv'; dotenv.config({ path: '../.env' });
import router from "./router.js";
import cors from 'cors';
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

const app = express();
const port = process.env.PORT || 8080;

app.disable("x-powered-by");
app.set('trust proxy', true);

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


const chars = await Char.find().exec();
const specNames = [...new Set(chars.map((char) => char.activeSpec?.name).filter(Boolean))];
const classesNames = [...new Set(chars.map((char) => char.class?.name).filter(Boolean))];
const specs = await GameSpecialization.find({ name: { $in: specNames } }).select("_id name").exec();
const classes = await GameClass.find({ name: { $in: classesNames } }).select("_id name").exec();
const specIdsByName = new Map(specs.map((spec) => [spec.name, spec._id]));
const classIdsByName = new Map(classes.map((cls) => [cls.name, cls._id]));

let len = 0;
const bulkOps = chars.map((char) => {
    const activeSpecID = specIdsByName.get(char.activeSpec?.name);
    const classID = classIdsByName.get(char.class?.name);
    if (!activeSpecID) throw new Error(`Missing specialization: ${char.activeSpec?.name}`);
    if (!classID) throw new Error(`Missing class: ${char.class?.name}`);

    len += 1;
    return {
        updateOne: {
            filter: { _id: char._id },
            update: { $set: { activeSpecID, classID, class: classID, activeSpec: activeSpecID } },
        },
    };
});
// class: classID, activeSpec: activeSpecID

if (bulkOps.length) await Char.bulkWrite(bulkOps);

console.info(len)

// const char = await findCharFromDatabase.byCredentials("eu", "chamber-of-aspects", "Lychezar");
// console.info(JSON.stringify(char, null, 4));
// debugger
