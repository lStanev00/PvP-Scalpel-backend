import { redisCache } from "../helpers/redis/connectRedis.js";
import threadBoot from "../helpers/threadBoot.js";
import publishPNotes from "./Service-Helpers/CFPNotes/publishPNotes.js";
import { getLatestPNotes } from "./Service-Helpers/CFPNotes/getLatesPNotes.js";
import getPostContent from "./Service-Helpers/CFPNotes/getPostContent.js";
import Service from "../Models/Services.js";

async function checkForPNotes() {
    const serviceDoc = await Service.findOne({ service: "CFPNotes" });
    if (!serviceDoc) throw new Error("[CFPNotes] Service record not found.");
    if (serviceDoc.running) return;

    serviceDoc.running = true;
    await serviceDoc.save();

    try {
        const latestPNotes = await getLatestPNotes();
        if (!latestPNotes?.id) throw new Error("[CFPNotes] No latest patch notes found.");
        if (serviceDoc.data.includes(latestPNotes.id)) return;

        const postContent = await getPostContent(latestPNotes);
        await publishPNotes(postContent, {
            publish: (channel, message) => redisCache.publish(channel, message),
            docID: serviceDoc.id,
        });
    } finally {
        serviceDoc.running = false;
        await serviceDoc.save();
    }
}

let exitCode = 0;
try {
    await threadBoot(true);
    await checkForPNotes();
} catch (error) {
    console.error(error);
    exitCode = 1;
}
process.exit(exitCode);
