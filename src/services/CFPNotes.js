import { redisCache } from "../helpers/redis/connectRedis.js";
import setCache from "../helpers/redis/setterRedis.js";
import threadBoot from "../helpers/threadBoot.js";
import publishPNotes from "./Service-Helpers/CFPNotes/publishPNotes.js";
import { getLatestPNotes } from "./Service-Helpers/CFPNotes/getLatesPNotes.js";
import getPostContent from "./Service-Helpers/CFPNotes/getPostContent.js";
import Service from "../Models/Services.js";

await threadBoot(true);

const sName = "CFPNotes"
const serviceDoc = await Service.findOne({service: sName});

try {
    
    if (serviceDoc.running) process.exit(0);
    serviceDoc.running = true;
    await serviceDoc.save();
    
    const latestPNotes = await getLatestPNotes()
    if (!latestPNotes?.id) process.exit(1);
    
    if (serviceDoc.data.includes(latestPNotes.id)) process.exit(0)
    
    const postContent = await getPostContent(latestPNotes);
    await publishPNotes(postContent, {
        publish: (channel, message) => redisCache.publish(channel, message),
        docID: serviceDoc.id,
    });
    
    // console.info(JSON.stringify({ analysis, card }, null, 4));
    // console.info(JSON.stringify(analysis, null, 4));
    
} catch (error) {
    console.error(error)
} finally {
    serviceDoc.running = false;
    await serviceDoc.save()
    process.exit(0);
}
