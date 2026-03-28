import { parentPort } from "node:worker_threads";
import { DBconnect } from "../../helpers/mongoHelper.js";
import connectRedis, { redisCache } from "../../helpers/redis/connectRedis.js";

await DBconnect(true);
await connectRedis(true);

export default function chOrLog(msg, type= undefined ) {
    let printText = `[chOrchestrator] ${msg ? msg : type}`;

    if(!type) return console.info(printText);

    switch(type) {

        case "log": console.log(printText);

        case "info": console.info(printText);

        case "warn": console.warn(printText);
        
        case "error": console.error(printText);

    }
}

const subClone = redisCache.duplicate();
const key = "CharQueue";

await subClone.pSubscribe(`__keyspace@0__:${key}`, (event, channel) => {
    if (!(event.includes("push"))) return

    
})


parentPort.on("message", async (jobInfo) => {

    const { type, data } = jobInfo;

})

chOrLog("BOOTED", "info");

// Hello buddy how're ya doing?
