import { fork } from "node:child_process";
import { redisCache } from "../../helpers/redis/connectRedis.js";



export default class JobQueue {
    constructor(index = 0) {
        this.name = `JobQueue${index ? " " +  index : ""}`;
        this.procRef = undefined;
        this.subClone = redisCache.duplicate(); 

    }

    async onSubscribe() {
        this.procRef = fork()
    }   


}