import { DBconnect } from "../../helpers/mongoHelper.js";
import connectRedis from "../../helpers/redis/connectRedis.js";
import updateDBAchieves from "../../services/updateAchieves.js";

await DBconnect(true);
await connectRedis(true);

const success = await updateDBAchieves();

process.exit(success ? 0 : 1);
