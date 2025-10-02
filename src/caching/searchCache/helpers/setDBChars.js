import { Worker } from "node:worker_threads";
import { delay } from "../../../helpers/startBGTask.js";
import CharSearchModel from "../../../Models/SearchCharacter.js";

export default async function setDBChars () {
    try {
        const data = await CharSearchModel.find().populate({
            path: "relChars",
            select: "_id name playerRealm server class search"
        }).lean();
        if (data.length === 0 ) return;
        
        const THREADS = 3;
        let finished_count = 0;
        const chunkSize = Math.ceil(data.length / THREADS);
        console.info(`[SChar Cache] Total ${data.length} documents, splitting into ${THREADS} chunks...`);


        for (let i = 0; i < THREADS; i++) {
            const chunk = data.slice(i * chunkSize, (i + 1) * chunkSize);
            if (chunk.length === 0) continue;
    
            const worker = new Worker(new URL("./setDBWorker.js", import.meta.url), {
                workerData: chunk,
                type: "module"
            });
    
            worker.on("message", msg => console.log(`Worker ${i}:`, msg));
            worker.on("error", err => console.error(`Worker ${i} error:`, err));
            worker.on("exit", code => {
                // console.info(`[SChar Cache] Theread-${i} exited with code ${code}`);
                finished_count += 1;
                if (finished_count === THREADS) {
                    return true
                }

            });
        }

        while (finished_count < THREADS) {
            await delay(200);
        }

    } catch (error) {
        console.warn(error)
        return null
    }
}