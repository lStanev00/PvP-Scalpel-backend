import { fork } from "child_process";
import { delay } from "../../helpers/startBGTask.js";

export default async function checkForPatchNotes() {
    while (true) {
        let exited = false;
        const task = fork("src/services/CFPNotes.js");

        task.on("exit", () => {
            exited = true;
        });
        task.on("error", (error) => {
            console.warn("[checkForPatchNotes] child process error:", error);
            exited = true;
        });

        // while (exited !== true) await delay(3000);
        await delay(180000); // 3 minutes delay
    }
    // src\services\updateRealms.js
}