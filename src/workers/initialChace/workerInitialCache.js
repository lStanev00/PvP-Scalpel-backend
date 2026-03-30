import initialCache from "../../caching/initialCache.js";
import threadBoot from "../../helpers/threadBoot.js";

await threadBoot(true)
const success = await initialCache();

process.exit(success ? 0 : 1);