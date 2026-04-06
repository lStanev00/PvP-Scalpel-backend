import isPlainObject from "../../helpers/objectCheck.js";

/**
 * Send a message-style WebSocket payload.
 *
 * @param {{ send: (payload: string) => unknown }} ws
 * @param {string} type
 * @param {string} message
 * @param {Record<string, unknown>|undefined} [extra]
 * @returns {unknown}
 */
export function wsMessage(ws, type, message, extra = undefined) {
    const payload = { type, message };

    if (isPlainObject(extra)) Object.assign(payload, extra);

    return ws.send(JSON.stringify(payload));
}

/**
 * Send a data-style WebSocket payload.
 *
 * @param {{ send: (payload: string) => unknown }} ws
 * @param {string} type
 * @param {unknown} [data]
 * @returns {unknown}
 */
export function wsResponse(ws, type, data = undefined) {
    const payload = { type };

    if (typeof data === "undefined") {
        return ws.send(JSON.stringify(payload));
    }

    if (isPlainObject(data)) {
        Object.assign(payload, data);
    } else {
        payload.data = data;
    }

    return ws.send(JSON.stringify(payload));
}
