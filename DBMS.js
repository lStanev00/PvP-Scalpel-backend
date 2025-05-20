import express from "express";
import dotenv from 'dotenv'; dotenv.config({ path: '../.env' });
import { DBconnect } from "./src/helpers/mongoHelper.js";
import router from "./src/router.js";
import cors from 'cors'
import cookieParser from "cookie-parser";
import { startBackgroundTask } from "./src/helpers/startBGTask.js";
import { updateGuildMembersData } from "./src/services/Patch.js";

const app = express();
const port = 59533;

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