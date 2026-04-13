// version: 0.2.11
import http from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import dotenv from "dotenv";
import { getConnectionLogContext } from "./helpers/ipHelpers.js";
import { wsMessage } from "./WS/helpers/wsResponseHelpers.js";
import wsRouter from "./WS/wsRouter.js";
import threadBoot from "./helpers/threadBoot.js";
import { isAllowedOrigin } from "./corsSetup.js";

dotenv.config();

const port = process.env.WSPORT || 8080;
await threadBoot()

const server = http.createServer();
const wss = new WebSocketServer({ noServer: true });
const robotsBody = "User-agent: *\nDisallow: /\n";
const bare500Response = "HTTP/1.1 500 Internal Server Error\r\n\r\n";

function getRequestPath(req) {
    return typeof req?.url === "string" ? req.url.split("?")[0] : "";
}

function writeBare500(socket) {
    socket.write(bare500Response);
    socket.destroy();
}

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

server.on("listening", () => {
    console.log(`WS running on ws://localhost:${port} or wss://ws.pvpscalpel.com`);
});

server.on("request", (req, res) => {
    const requestPath = getRequestPath(req);

    if (requestPath === "/robots.txt") {
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(robotsBody);
        return;
    }

    res.socket.write(bare500Response);
    res.socket.destroy();
});

server.on("upgrade", (req, socket, head) => {
    const connectionContext = getConnectionLogContext(req);
    const requestPath = getRequestPath(req);

    if (requestPath !== "/") {
        writeBare500(socket);
        return;
    }

    if (!isAllowedOrigin(connectionContext.origin)) {
        console.warn("[WS] rejected upgrade", {
            ip: connectionContext.ip,
            origin: connectionContext.origin,
            url: connectionContext.url,
        });
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
    });
});

wss.on("connection", (ws, req) => {
    ws.isAlive = true;
    const connectionContext = getConnectionLogContext(req);

    console.log("[WS] client connected", connectionContext.ip, connectionContext.origin ?? "no-origin");

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

server.listen(port);
// 2[Adventureman:argent-dawn:eu(254)|Oifik:frostmane:eu(1480)|Zamruka:ravenholdt:eu(261)|Калмычка:gordunni:eu(256)|Akemi:eredar:eu(252)|Øéyx:ravencrest:eu(1468)|Lychezar:chamber-of-aspects:eu(73)|Снюсловер:gordunni:eu(102)][Aylanur:ravencrest:eu(103)|Balúr:thrall:eu(264)|Canhalli:the-maelstrom:eu(270)|Causality:sylvanas:eu(577)|Ledva:drakthul:eu(70)|Onlylock:ragnaros:eu(267)|Tyranorde:hyjal:eu(73)|Zaijko:stormscale:eu(251)]