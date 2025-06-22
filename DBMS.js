import express from "express";
import dotenv from 'dotenv'; dotenv.config({ path: '../.env' });
import { DBconnect } from "./src/helpers/mongoHelper.js";
import router from "./src/router.js";
import cors from 'cors'
import cookieParser from "cookie-parser";
import { delay, startBackgroundTask } from "./src/helpers/startBGTask.js";
import { updateGuildMembersData } from "./src/services/Patch.js";
import updateDBAchieves from "./src/services/updateAchieves.js";

const app = express();
const port = process.env.PORT || 8080;

app.disable("x-powered-by");
app.set('trust proxy', true);

await DBconnect();
const allowedOrigins = [
  "https://pvpscalpel.com",
  "https://www.pvpscalpel.com",
  "http://localhost:5173" // If needed for local development
];

// Enable CORS
// app.use(
//   cors({
//     origin: (origin, callback) => {
//       if (!origin || allowedOrigins.includes(origin)) {
//         callback(null, true);
//       } else {
//         callback(new Error("Not allowed by CORS"));
//       }
//     },
//     credentials: true, // Allow cookies, auth headers
//   })
// );
app.use(cors({
  origin: true,
  credentials: true
}));
app.options('*', cors()); // enable pre-flight for all routes
app.use(cookieParser());
app.use(express.json({ extended: false }));
app.use(`/`, router);


app.listen(port, console.log(`Server's running at http://localhost:${port} or https://api.pvpscalpel.com`));

await startBackgroundTask(updateGuildMembersData, 3600000);
await delay(1000);
await startBackgroundTask(updateDBAchieves, 604800000); // 1 week