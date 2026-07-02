// version: 1.9.0
import { promisify } from "node:util";
import { redisCharacterCacheTTL } from "../helpers/redis/connectRedis.js";
import threadBoot from "../helpers/threadBoot.js";
import startServices from "../services/servicesMain.js";
import { execFile } from "node:child_process";

await threadBoot();
// await dropCachedCharactersForWorkerStartup();
await startServices();

async function dropCachedCharactersForWorkerStartup() {
    try {
        await redisCharacterCacheTTL.flushDb();
        console.info("[Worker] Character payload cache dropped");
    } catch (error) {
        console.error("[Worker] Failed to drop character payload cache");
        console.error(error);
    }
}

async function scanFolder(path) {
    const execFileAsync = promisify(execFile);
    if (typeof path !== "string") {
        return console.warn("path has to be a string at scanFolder");
    }

    const folderPath = "/mnt/s3-bucket" + path;
    try {
        const { stdout } = await execFileAsync(
            "clamdscan",
            [
                "--fdpass",
                "--config-file",
                "/etc/clamav/clamd.conf",
                "--recursive",
                "--infected",
                folderPath,
            ],
            {
                timeout: 30 * 60 * 1000,
                maxBuffer: 10 * 1024 * 1024,
            },
        );

        return {
            clean: true,
            infected: false,
            output: stdout,
        };
    } catch (error) {
        if (error.code === 1) {
            return {
                clean: false,
                infected: true,
                output: error.stdout || "",
            };
        }

        throw new Error(`ClamAV folder scan failed: ${error.stderr || error.message}`);
    }
}

console.info(await scanFolder(""));