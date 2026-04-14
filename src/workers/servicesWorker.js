// version: 1.5.2
import threadBoot from "../helpers/threadBoot.js";
import startServices from "../services/servicesMain.js";

await threadBoot();
await startServices();
