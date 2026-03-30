// version: 0.1.7
import { WebSocketServer } from "ws";
import dotenv from "dotenv";
import { getConnectionLogContext } from "./helpers/ipHelpers.js";
import { wsMessage } from "./WS/helpers/wsResponseHelpers.js";
import wsRouter from "./WS/wsRouter.js";
import threadBoot from "./helpers/threadBoot.js";

dotenv.config();

const port = process.env.WSPORT || 8080;
await threadBoot()

const wss = new WebSocketServer({ port });

wss.on("listening", () => {
    console.log(`WS running on ws://localhost:${port} or wss://ws.pvpscalpel.com`);
});

wss.on("connection", (ws, req) => {
    console.log("[WS] client connected", getConnectionLogContext(req).ip);

    wsMessage(ws, "connected", "welcome");

    ws.on("message", (raw) => wsRouter(ws, raw));

    ws.on("close", () => {
        console.log("client disconnected");
    });

    ws.on("error", (err) => {
        console.error("ws error", err);
    });
});
