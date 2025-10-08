import express from "express";
import dotenv from 'dotenv'; dotenv.config({ path: '../.env' });
import { DBconnect } from "./src/helpers/mongoHelper.js";
import router from "./src/router.js";
import cors from 'cors';
import cookieParser from "cookie-parser";
import { corsOptions, productionUrl } from "./src/corsSetup.js";
import sanitizer from "./src/middlewares/sanitizer.js";
import compression from "compression";
import connectRedis from "./src/helpers/redis/connectRedis.js";
import { Worker } from "worker_threads";
import { delay } from "./src/helpers/startBGTask.js";

const app = express();
const port = process.env.PORT || 8080;

app.disable("x-powered-by");
app.set('trust proxy', true);

await DBconnect();
await connectRedis();

await delay(2000);
app.use(compression());
 
app.use(cors(corsOptions));
app.options(/^\/(.*)/, cors(corsOptions)); // enable pre-flight for all routes
app.use(cookieParser());
app.use(express.json({ extended: false }));
app.use("/", sanitizer);
app.use(`/`, router);

app.listen(port, console.info(`REST's running at http://localhost:${port} or ${productionUrl}`));

// start worker for services
new Worker(new URL("./src/workers/servicesWorker.js", import.meta.url), { type: "module" });