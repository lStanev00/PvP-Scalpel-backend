import { parentPort } from "worker_threads";
import startServices from "../services/servicesMain.js"
import { DBconnect } from "../helpers/mongoHelper.js";
import connectRedis from "../helpers/redis/connectRedis.js";

(async () => {
    await DBconnect(true);
    await connectRedis(true);
    await startServices();
})()