import startServices from "../services/servicesMain.js"
import { DBconnect } from "../helpers/mongoHelper.js";
import connectRedis from "../helpers/redis/connectRedis.js";
import { delay } from "../helpers/startBGTask.js";
// import { parentPort } from "node:worker_threads";
// import { CharSearchCacheEmiter } from "../caching/searchCache/charSearchCache.js";

await DBconnect(true);
await connectRedis(true);
(async () => {

    await delay(5000);
    
    await startServices();
})()

// parentPort.on('message', (msg) => {
//     console.log('Worker received:', msg);

//     if (msg.type === 'purge') {
//         // do your wipeCharSearchEntry(msg.payload)
//         const msgArgs = msg.payload;
//         if (!(Array.isArray(msgArgs))) return;
//         CharSearchCacheEmiter.emit("purge", ...msgArgs)
//         parentPort.postMessage({ type: 'done', result: 200 });
//     }
// });