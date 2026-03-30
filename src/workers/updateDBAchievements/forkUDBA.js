import threadBoot from "../../helpers/threadBoot.js";
import updateDBAchieves from "../../services/updateAchieves.js";

await threadBoot(true);
const success = await updateDBAchieves();

process.exit(success ? 0 : 1);
