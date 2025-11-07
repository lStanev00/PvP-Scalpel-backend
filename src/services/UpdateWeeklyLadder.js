import { cacheWeeklyData, WeeklyEmitter } from "../caching/weeklyChamps/weeklyChampsCache.js";
import Service from "../Models/Services.js";
import determinateWeeklyWinners from "./Service-Helpers/updateWeeklyLadder/determinateWeeklyWinners.js";
import isSameDay from "./Service-Helpers/updateWeeklyLadder/isSameDay.js";

export default async function updateWeeklyLadder() {
    const serviceName = "updateWeeklyLadder";
    const today = new Date();

    if (today.getDay() === 1) {
        // It's Monday!
        const serviceMetaData = await Service.findOne({ service: serviceName });

        const shouldRun =
            !serviceMetaData.lastRun ||
            (!isSameDay(serviceMetaData.lastRun, today) && serviceMetaData.running === false);

        if (shouldRun) {
            WeeklyEmitter.emit("info", "Starting weekly reset...");
            serviceMetaData.running = true;
            await serviceMetaData.save(); // Store in db that the service is starting;
            let success = false;
            try {
                success = await determinateWeeklyWinners();
            } catch (error) {
                WeeklyEmitter.emit("error", `AT: UpdateWeeklyLadder\n => During weekly reset \n Logging Error:`);
                console.error(error);
            } finally {
                serviceMetaData.running = false;
                serviceMetaData.lastRun = success ? today : serviceMetaData.lastRun;
                const result = await serviceMetaData.save();
                if (success && result) WeeklyEmitter.emit("update", `Just reseted the weekly and stored in base with id:\n => ${result.id}`)
                return result;
            }
        }
    }

    await cacheWeeklyData();
}
