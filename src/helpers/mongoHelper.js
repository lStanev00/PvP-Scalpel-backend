import mongoose from "mongoose";
// const dbName = `PvP-Scalpel`
// const uri = `mongodb://127.0.0.1:27017/${dbName}`
import dotenv, { configDotenv } from 'dotenv';
dotenv.config({path: "../../.env"});
configDotenv();
const MONGODB_CONNECTION= process.env.MONGODB_CONNECTION

export async function DBconnect(silent = false) {
    try {
        await mongoose.connect(MONGODB_CONNECTION);
        await import("../Models/Achievements.js")
        await import("../Models/BlizAPIErrors.js")
        await import("../Models/CharWeeklySnaphsot.js")
        await import("../Models/Chars.js")
        await import("../Models/Post.js")
        await import("../Models/Realms.js")
        await import("../Models/Regions.js")
        await import("../Models/SearchCharacter.js")
        await import("../Models/SearchRealm.js")
        await import("../Models/Services.js")
        await import("../Models/User.js")
        await import("../Models/WeeklyWinnersRecord.js")
        if(silent === false) console.log("MongoDB Connected Successfully and models registered!");
    } catch (err) {
        console.error("MongoDB Connection Error:", err.message);
        process.exit(1); 
    }
};
