import { fork } from "child_process";
import { delay } from "../../helpers/startBGTask.js";

export default async function WDWBJob() {
    while (true) {
        let exited = false;
        const task = fork("src/services/mergeDuplicateWarbands.js");

        task.on("exit", () => {
            exited = true;
        });
        task.on("error", (error) => {
            console.warn("[WDWBJob] child process error:", error);
            exited = true;
        });

        // while (exited !== true) await delay(3000);
        await delay(10800000); // 3 minutes delay
    }
}