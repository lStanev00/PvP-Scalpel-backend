import { wsMessage } from "./helpers/wsResponseHelpers.js";
import pingHandler from "./wsHandlers/pingHandler.js";
import queueCheckHandler from "./wsHandlers/queueCheckHandler.js";
import unknownHandler from "./wsHandlers/unknownHandler.js";

/**
 * Route parsed WebSocket messages to the current handler set.
 *
 * @param {{ send: (payload: string) => unknown }} ws
 * @param {{ type?: unknown, data?: unknown }} msg
 * @returns {Promise<void>}
 */
export default async function wsRouter(ws, raw) {
    let msg;
    try {
        msg = JSON.parse(raw.toString());
    } catch {
        wsMessage(ws, "error", "invalid json");
        return;
    }

    switch (msg?.type) {
        case "ping":
            return await pingHandler(ws, msg);
        case "queueCheck":
            return await queueCheckHandler(ws, msg);
        default:
            return await unknownHandler(ws, msg);
    }
}
