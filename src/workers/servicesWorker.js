// version: 1.4.5
import threadBoot from "../helpers/threadBoot.js";
import startServices from "../services/servicesMain.js";
// import { DBconnect } from "../helpers/mongoHelper.js";
// import connectRedis from "../helpers/redis/connectRedis.js";
// import startRedisCharSubscriber from "../helpers/redis/charSubscriber.js";

// await DBconnect();
// await connectRedis();
// await startRedisCharSubscriber();

await threadBoot();
await startServices();
