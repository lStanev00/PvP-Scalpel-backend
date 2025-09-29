import express from "express";
import dotenv from 'dotenv'; dotenv.config({ path: '../.env' });
import { DBconnect } from "./src/helpers/mongoHelper.js";
import router from "./src/router.js";
import cors from 'cors';
import cookieParser from "cookie-parser";
import { corsOptions, productionUrl } from "./src/corsSetup.js";
import sanitizer from "./src/middlewares/sanitizer.js";
import compression from "compression";
import startServices from "./src/services/servicesMain.js";

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

await startServices();

app.listen(port, console.info(`Server's running at http://localhost:${port} or ${productionUrl}`));


console.info(REDIS_HOST )