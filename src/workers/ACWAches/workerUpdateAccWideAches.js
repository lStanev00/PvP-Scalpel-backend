import { fork } from "node:child_process";
import { delay } from "../../helpers/startBGTask.js";

export default async function workerUpdateAccWideAches() {
    while (true) {
        let exited = false;
        const task = fork("src/services/updateAccWideAches.js");

        task.on("exit", () => {
            exited = true;
        });
        task.on("error", (error) => {
            console.warn("[workerUpdateAccWideAches] child process error:", error);
            exited = true;
        });

        while (exited !== true) await delay(3000);
        await delay(604800000); // 1 week
    }
}
