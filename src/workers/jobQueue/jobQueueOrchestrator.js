import { parentPort } from "node:worker_threads";
import { DBconnect } from "../../helpers/mongoHelper.js";
import connectRedis, { redisCache } from "../../helpers/redis/connectRedis.js";
import getCache from "../../helpers/redis/getterRedis.js";
import setCache from "../../helpers/redis/setterRedis.js";

await DBconnect(true);
await connectRedis(true);

const key = "JobQueue";
export default function JQOLog(msg, type= undefined ) {
    let printText = `[JQOrchestrator] ${msg ? msg : type}`;

    if(!type) return console.info(printText);

    switch(type) {

        case "log": console.log(printText);

        case "info": console.info(printText);

        case "warn": console.warn(printText);
        
        case "error": console.error(printText);

    }
}

const subClone = redisCache.duplicate();
export const isQueueWorker1Up = async () => await getCache("worker1");
export const isQueueWorker2Up = async () => await getCache("worker2");

//todo as above make 2 seters this is 


await subClone.pSubscribe(`__keyspace@0__:${key}`, async (event, channel) => {
    if (!(event.includes("push"))) return

    if(await getCache(isQueueWorker1Up) !== true ) {
        // boot
        // await setCache(worker1, true);
    }

    // return send the work

    if (job.type = "bulkCharSearch") {
        if(await getCache(isQueueWorker2Up) !== true) {
            // boot
            // await setCache(worker1, true);

        }

    }
    
})


parentPort.on("message", async (jobInfo) => {

    const { type, data } = jobInfo;

})

JQOLog("BOOTED", "info");

// Hello buddy how're ya doing?
