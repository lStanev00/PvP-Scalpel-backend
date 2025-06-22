import mongoose from "mongoose";
// const dbName = `PvP-Scalpel`
// const uri = `mongodb://127.0.0.1:27017/${dbName}`
import dotenv from 'dotenv';
dotenv.config({path: "../../.env"});
const MONGODB_CONNECTION= process.env.MONGODB_CONNECTION

export async function DBconnect() {
    try {
        await mongoose.connect(MONGODB_CONNECTION);
        console.log("MongoDB Connected Successfully!");
    } catch (err) {
        console.error("MongoDB Connection Error:", err.message);
        process.exit(1); 
    }
};
