
import { fork } from "node:child_process";
import { delay } from "../../helpers/startBGTask.js";

export default async function WDWBJob() {
    let running = false;

    while (true) {
        if (!running) {
            running = true;

            const task = fork("src/services/mergeDuplicateWarbands.js");

            task.once("exit", (code) => {
                console.log(`[WDWBJob] Exited with code ${code}`);
                running = false;
            });

            task.once("error", (error) => {
                console.warn("[WDWBJob] Child process error:", error);
                running = false;
            });
        }

        await delay(43_200_000); // 12 hours
    }
}
