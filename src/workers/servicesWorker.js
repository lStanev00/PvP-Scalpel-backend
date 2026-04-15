// version: 1.6.11
import threadBoot from "../helpers/threadBoot.js";
import startServices from "../services/servicesMain.js";

await threadBoot();
await startServices();