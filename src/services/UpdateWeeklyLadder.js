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
                const wBracketsData = await determinateWeeklyWinners();
                success = true;
            } catch (error) {
                console.error(error);
            } finally {
                serviceMetaData.running = false;
                serviceMetaData.lastRun = success ? today : serviceMetaData.lastRun;
                await serviceMetaData.save();
                return;
            }
        }
    }

    await cacheWeeklyData();
}
