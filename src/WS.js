// version: 0.1.12
import WebSocket, { WebSocketServer } from "ws";
import dotenv from "dotenv";
import { getConnectionLogContext } from "./helpers/ipHelpers.js";
import { wsMessage } from "./WS/helpers/wsResponseHelpers.js";
import wsRouter from "./WS/wsRouter.js";
import threadBoot from "./helpers/threadBoot.js";

dotenv.config();

const port = process.env.WSPORT || 8080;
await threadBoot()

const wss = new WebSocketServer({ port });
const heartbeatInterval = setInterval(() => {
    for (const client of wss.clients) {
        if (client.readyState !== WebSocket.OPEN) continue;

        if (client.isAlive === false) {
            client.terminate();
            continue;
        }

        client.isAlive = false;
        client.ping();
    }
}, 30000);

heartbeatInterval.unref?.();

wss.on("listening", () => {
    console.log(`WS running on ws://localhost:${port} or wss://ws.pvpscalpel.com`);
});

wss.on("connection", (ws, req) => {
    ws.isAlive = true;
    const connectionContext = getConnectionLogContext(req);

    console.log("[WS] client connected", connectionContext.ip);

    wsMessage(ws, "connected", "welcome");

    ws.on("message", async (raw) => {
        try {
            await wsRouter(ws, raw);
        } catch (err) {
            console.error("[WS] message handler failed", {
                ip: connectionContext.ip,
                error: err,
            });
        }
    });
    ws.on("pong", () => {
        ws.isAlive = true;
    });

    ws.on("close", () => {
        console.log("client disconnected");
    });

    ws.on("error", (err) => {
        console.error("ws error", err);
    });
});

wss.on("close", () => {
    clearInterval(heartbeatInterval);
});
