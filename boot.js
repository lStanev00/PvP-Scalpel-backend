import express from "express";
import dotenv from 'dotenv'; dotenv.config({ path: '../.env' });
import router from "./src/router.js";
import cors from 'cors';
import cookieParser from "cookie-parser";
import { corsOptions, productionUrl } from "./src/corsSetup.js";
import sanitizer from "./src/middlewares/sanitizer.js";
import compression from "compression";
import { fork } from "node:child_process";
import { delay } from "./src/helpers/startBGTask.js";
import threadBoot from "./src/helpers/threadBoot.js";

const app = express();
const port = process.env.PORT || 8080;

app.disable("x-powered-by");
app.set('trust proxy', true);

await threadBoot();

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
const servicesWorker = fork("src/workers/servicesWorker.js");
servicesWorker.on("error", (error) => {
    console.error("servicesWorker error:", error);
    debugger
});
servicesWorker.on("exit", (code) => {
    if (code !== 0) {
        console.warn(`servicesWorker exited with code ${code}`);
    }
});
