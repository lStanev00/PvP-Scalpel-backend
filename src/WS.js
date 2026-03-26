// version: 0.0.4
import { WebSocketServer } from "ws";
import dotenv from "dotenv";
import { DBconnect } from "./helpers/mongoHelper.js";
import connectRedis from "./helpers/redis/connectRedis.js";
import GameBrackets from "./Models/GameBrackets.js";

dotenv.config();

const port = process.env.WSPORT || 8080;
await DBconnect();
await connectRedis();

[
    {
        _id: 0,
        name: "Unknown",
        isRated: false,
        isSolo: false,
    },
    {
        _id: 1,
        name: "Solo Shuffle",
        isRated: true,
        isSolo: true,
    },
    {
        _id: 2,
        name: "Battleground Blitz",
        isRated: true,
        isSolo: true,
    },
    {
        _id: 3,
        name: "Rated Arena 2v2",
        isRated: true,
        isSolo: false,
    },
    {
        _id: 4,
        name: "Rated Arena 3v3",
        isRated: true,
        isSolo: false,
    },
    {
        _id: 5,
        name: "Rated Arena",
        isRated: true,
        isSolo: false,
    },
    {
        _id: 6,
        name: "Rated Battleground",
        isRated: true,
        isSolo: false,
    },
    {
        _id: 7,
        name: "Arena Skirmish",
        isRated: false,
        isSolo: false,
    },
    {
        _id: 8,
        name: "Brawl",
        isRated: false,
        isSolo: false,
    },
    {
        _id: 9,
        name: "Random Battleground",
        isRated: false,
        isSolo: false,
    },
    {
        _id: 10,
        name: "Random Epic Battleground",
        isRated: false,
        isSolo: false,
    },
].forEach(entry => {
    const newDBEntry = new GameBrackets(entry);
    newDBEntry.save();
})

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
