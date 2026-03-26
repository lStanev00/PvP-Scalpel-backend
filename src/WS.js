// version: 0.1.2
import { WebSocketServer } from "ws";
import dotenv from "dotenv";
import { DBconnect } from "./helpers/mongoHelper.js";
import connectRedis from "./helpers/redis/connectRedis.js";
import { wsMessage } from "./WS/helpers/wsResponseHelpers.js";
import wsRouter from "./WS/wsRouter.js";

dotenv.config();

const port = process.env.WSPORT || 8080;
await DBconnect();
await connectRedis();

const wss = new WebSocketServer({ port });

wss.on("listening", () => {
    console.log(`WS running on ws://localhost:${port} or wss://ws.pvpscalpel.com`);
});

wss.on("connection", (ws, req) => {
    console.log("client connected", req.socket.remoteAddress);

    wsMessage(ws, "connected", "welcome");

    ws.on("message", (raw) => wsRouter(ws, raw));

    ws.on("close", () => {
        console.log("client disconnected");
    });

    ws.on("error", (err) => {
        console.error("ws error", err);
    });
});
