import Char from "../Models/Chars.js";
import Service from "../Models/Services.js";

export default async function updateWeeklyLadder() {
    const serviceName = "updateWeeklyLadder";
    const guildCharList = await Char.find({  guildMember: true  });
    const today = new Date();
    
    if (today.getDay() === 1) { // It's Monday!
        const serviceMetaData = await Service.findOne({service: serviceName});
        if (!serviceMetaData.lastRun 
            || !isSameDay(serviceMetaData.lastRun, today) 
            && serviceMetaData.running === false
        ) {
            serviceMetaData.running = true;
            await serviceMetaData.save(); // Store in db that the service is starting;
            
        }
    }

}

function isSameDay(d1, d2) {
    return d1.getFullYear() === d2.getFullYear() &&
           d1.getMonth() === d2.getMonth() &&
           d1.getDate() === d2.getDate();
}