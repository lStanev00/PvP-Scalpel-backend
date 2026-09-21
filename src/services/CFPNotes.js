import { redisCache } from "../helpers/redis/connectRedis.js";
import getCache from "../helpers/redis/getterRedis.js";
import setCache from "../helpers/redis/setterRedis.js";
import threadBoot from "../helpers/threadBoot.js";
import publishPNotes from "./Service-Helpers/CFPNotes/publishPNotes.js";
import { getLatestPNotes } from "./Service-Helpers/CFPNotes/getLatesPNotes.js";
import getPostContent from "./Service-Helpers/CFPNotes/getPostContent.js";

await threadBoot(true);

const HASH_NAME = "CFPNotes";

const latestPNotes = await getLatestPNotes()
if (!latestPNotes?.id) process.exit(1);

const latestCache = await getCache(HASH_NAME);
if (latestCache === latestPNotes.id) process.exit(0);

const postContent = await getPostContent(latestPNotes);
await publishPNotes(postContent, {
    publish: (channel, message) => redisCache.publish(channel, message),
    cache: setCache,
});

// console.info(JSON.stringify({ analysis, card }, null, 4));
// console.info(JSON.stringify(analysis, null, 4));
process.exit(0);
