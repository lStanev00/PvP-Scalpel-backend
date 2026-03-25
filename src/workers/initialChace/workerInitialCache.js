import initialCache from "../../caching/initialCache.js";
import { DBconnect } from "../../helpers/mongoHelper.js";
import connectRedis from "../../helpers/redis/connectRedis.js";

await DBconnect(true);
await connectRedis(true);

const success = await initialCache();

process.exit(success ? 0 : 1);