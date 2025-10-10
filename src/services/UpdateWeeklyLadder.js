import Service from "../Models/Services.js";
import determinateWeeklyWinners from "./Service-Helpers/updateWeeklyLadder/determinateWeeklyWinners.js";
import isSameDay from "./Service-Helpers/updateWeeklyLadder/isSameDay.js";

export default async function updateWeeklyLadder() {
    const serviceName = "updateWeeklyLadder";
    const today = new Date();

    if (today.getDay() === 1) {
        // It's Monday!
        const serviceMetaData = await Service.findOne({ service: serviceName });
        if (
            !serviceMetaData.lastRun ||
            (!isSameDay(serviceMetaData.lastRun, today) && serviceMetaData.running === false)
        ) {
            serviceMetaData.running = true;
            await serviceMetaData.save(); // Store in db that the service is starting;
            const wBracketsData = await determinateWeeklyWinners();

        }
    }
}