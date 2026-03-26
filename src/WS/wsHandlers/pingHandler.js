import { wsResponse } from "../helpers/wsResponseHelpers.js";

/**
 * Handle ping messages with a pong response timestamp.
 *
 * @param {{ send: (payload: string) => unknown }} ws
 * @returns {Promise<void>}
 */
export default async function pingHandler(ws) {
    wsResponse(ws, "pong", { at: Date.now() });
}
