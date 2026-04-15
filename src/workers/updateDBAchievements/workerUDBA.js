// src\workers\updateDBAchievements\forkUDBA.js

import { fork } from "node:child_process";
import { delay } from "../../helpers/startBGTask.js";

export default async function workerupdateDBAchieves() {
    while (true) {
        // this worker delay before 1st exec cuz is invoked in cache warmup;
        await delay(604800000) // 1 week 
        let exited = false;
        const task = fork("src/workers/updateDBAchievements/forkUDBA.js");

        task.on("exit", () => {
            exited = true;
        });
        task.on("error", (error) => {
            console.warn("[workerupdateDBAchieves] child process error:", error);
            exited = true;
        });

        while (exited !== true) await delay(2000);
    }
    // src\services\servicesMain.js
}
