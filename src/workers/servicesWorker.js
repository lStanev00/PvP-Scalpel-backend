import startServices from "../services/servicesMain.js"
import { DBconnect } from "../helpers/mongoHelper.js";
import connectRedis from "../helpers/redis/connectRedis.js";
import { delay } from "../helpers/startBGTask.js";

(async () => {
    await DBconnect(true);
    await connectRedis(true);

    await delay(5000);
    
    await startServices();
})()