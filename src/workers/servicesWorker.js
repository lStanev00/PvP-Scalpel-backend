// version: 1.8.5
import threadBoot from "../helpers/threadBoot.js";
import startServices from "../services/servicesMain.js";

await threadBoot();
await startServices();