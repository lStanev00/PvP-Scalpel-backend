import startServices from "../services/servicesMain.js"
import { DBconnect } from "../helpers/mongoHelper.js";
import connectRedis from "../helpers/redis/connectRedis.js";
import startRedisCharSubscriber from "../helpers/redis/charSubscriber.js";
import { delay } from "../helpers/startBGTask.js";

await DBconnect(true);
await connectRedis(true);
await startRedisCharSubscriber();

(async () => {

    await delay(5000);
    
    await startServices();
})()
