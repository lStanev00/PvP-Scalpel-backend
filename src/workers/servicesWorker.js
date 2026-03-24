// version: 1.3.1
import startServices from "../services/servicesMain.js";
import { DBconnect } from "../helpers/mongoHelper.js";
import connectRedis from "../helpers/redis/connectRedis.js";
// import startRedisCharSubscriber from "../helpers/redis/charSubscriber.js";
import { delay } from "../helpers/startBGTask.js";

await DBconnect();
await connectRedis();
// await startRedisCharSubscriber();

await delay(1500);

await startServices();
