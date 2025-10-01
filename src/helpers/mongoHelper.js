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
        if(silent === false) console.log("MongoDB Connected Successfully!");
    } catch (err) {
        console.error("MongoDB Connection Error:", err.message);
        process.exit(1); 
    }
};
