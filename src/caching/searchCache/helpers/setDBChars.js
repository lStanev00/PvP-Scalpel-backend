import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import CharSearchModel from "../../../Models/SearchCharacter.js";
import Char from "../../../Models/Chars.js";
import getCache from "../../../helpers/redis/getterRedis.js";
import { insertOneCharSearchMap } from "../charSearchCache.js";

export default async function setDBChars() {
    const hashName = "CharSearch";
    try {
        const THREADS = 6;
        const CHUNK_SIZE = 250;
        let workerIndex = 0;
        let hasData = false;
        let chunk = [];
        const activeWorkers = new Set();
        const childPath = fileURLToPath(new URL("./setDBWorker.js", import.meta.url));

        const startWorker = (workerChunk, index) => {
            const child = fork(childPath, {
                stdio: ["ignore", "ignore", "ignore", "ipc"],
            });

            const workerPromise = new Promise((resolve, reject) => {
                child.once("message", (msg) => console.log(`[charSearch Warmup] Worker ${index}:`, msg));
                child.once("error", (err) => {
                    console.error(`Worker ${index} error:`, err);
                    reject(err);
                });
                child.once("exit", (code) => {
                    if (code !== 0) {
                        reject(new Error(`Worker ${index} exited with code ${code}`));
                        return;
                    }
                    resolve();
                });

                child.send(workerChunk);
            }).finally(() => {
                activeWorkers.delete(workerPromise);
            });

            activeWorkers.add(workerPromise);
            return workerPromise;
        };

        const cursor = CharSearchModel.find()
            .populate({
                path: "relChars",
                select: "_id name playerRealm server class search",
            })
            .lean()
            .cursor();

        for await (const entry of cursor) {
            hasData = true;
            chunk.push(entry);

            if (chunk.length < CHUNK_SIZE) continue;

            startWorker(chunk, workerIndex);
            workerIndex += 1;
            chunk = [];

            if (activeWorkers.size >= THREADS) {
                await Promise.race(activeWorkers);
            }
        }

        if (chunk.length > 0) {
            startWorker(chunk, workerIndex);
        }

        if (!hasData) return;

        while (activeWorkers.size > 0) {
            await Promise.race(activeWorkers);
        }

        const chars = await Char.find({}, { _id: 1, search: 1 }).lean();

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
