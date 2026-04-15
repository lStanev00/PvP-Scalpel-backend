import { fork } from "child_process";
import { delay } from "../../helpers/startBGTask.js";

export default async function workerUpdateRealm() {
    while (true) {
        let exited = false;
        const task = fork("src/services/updateRealms.js");

        task.on("exit", () => {
            exited = true;
        });
        task.on("error", (error) => {
            console.warn("[workerUpdateRealm] child process error:", error);
            exited = true;
        });

        // while (exited !== true) await delay(3000);
        await delay(2147483647); // max 24.8 days
    }
    // src\services\updateRealms.js
}
