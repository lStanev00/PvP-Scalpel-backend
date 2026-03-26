// version: 0.0.1
import { WebSocketServer } from "ws";
import dotenv from "dotenv";

dotenv.config();

const port = process.env.WSPORT || 8080;
const wss = new WebSocketServer({ port });

wss.on("listening", () => {
    console.log(`WS running on ws://localhost:${port} or wss://ws.pvpscalpel.com`);
});

wss.on("connection", (ws, req) => {
    console.log("client connected", req.socket.remoteAddress);

    ws.send(
        JSON.stringify({
            type: "connected",
            message: "welcome",
        }),
    );

    ws.on("message", (raw) => {
        let msg;

        try {
            msg = JSON.parse(raw.toString());
        } catch {
            ws.send(
                JSON.stringify({
                    type: "error",
                    message: "invalid json",
                }),
            );
            return;
        }

        if (msg.type === "ping") {
            ws.send(
                JSON.stringify({
                    type: "pong",
                    at: Date.now(),
                }),
            );
            return;
        }

        ws.send(
            JSON.stringify({
                type: "unknown",
                receivedType: msg.type ?? null,
            }),
        );
    });

    ws.on("close", () => {
        console.log("client disconnected");
    });

    ws.on("error", (err) => {
        console.error("ws error", err);
    });
});
