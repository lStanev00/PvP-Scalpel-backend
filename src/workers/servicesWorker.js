// version: 1.4.6
import threadBoot from "../helpers/threadBoot.js";
import startServices from "../services/servicesMain.js";

await threadBoot();
await startServices();
