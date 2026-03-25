import { fork } from "node:child_process";
import { delay } from "../../../helpers/startBGTask.js";
import CharSearchModel from "../../../Models/SearchCharacter.js";
import Char from "../../../Models/Chars.js";
import getCache from "../../../helpers/redis/getterRedis.js";
import { insertOneCharSearchMap } from "../charSearchCache.js";

export default async function setDBChars() {
    const hashName = "CharSearch";
    try {
        const data = await CharSearchModel.find()
            .populate({
                path: "relChars",
                select: "_id name playerRealm server class search",
            })
            .lean();
        if (data.length === 0) return;

        const THREADS = 6;
        let finished_count = 0;
        const chunkSize = Math.ceil(data.length / THREADS);
        console.info(
            `[SChar Cache] Total ${data.length} documents, splitting into ${THREADS} chunks...`
        );

        for (let i = 0; i < THREADS; i++) {
            const chunk = data.splice(0, chunkSize);
            if (chunk.length === 0) continue;

            const worker = fork("src/caching/searchCache/helpers/setDBWorker.js");
            worker.send(chunk);

            worker.on("message", (msg) => console.log(`Worker ${i}:`, msg));
            worker.on("error", (err) => console.error(`Worker ${i} error:`, err));
            worker.on("exit", (code) => {
                // console.info(`[SChar Cache] Theread-${i} exited with code ${code}`);
                finished_count += 1;
                if (finished_count === THREADS) {
                    // return true
                }
            });
        }

        while (finished_count < THREADS) {
            await delay(200);
        }

        const chars = await Char.find().lean();

        try {
            for (const entry of chars) {
                const exist = await getCache(entry.search, hashName);

                if (!exist || exist === null) await insertOneCharSearchMap(entry);
            }

            return true;
        } catch (error) {
            console.error(error);
            return false;
        }

    } catch (error) {
        console.warn(error);
        return null;
    }
}
