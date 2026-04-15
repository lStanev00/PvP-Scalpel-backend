import { fork } from "node:child_process";
import { delay } from "../../helpers/startBGTask.js";

export default async function workerPatchGuildMembersData() {
    while (true) {
        let exited = false;
        const task = fork("src/services/PatchGuildMembersData.js");

        task.on("exit", () => {
            exited = true;
        });
        task.on("error", (error) => {
            console.warn("[workerPatchGuildMembersData] child process error:", error);
            exited = true;
        });

        while (exited !== true) await delay(3000);
        await delay(3600000); // 1 hr
    }
}
