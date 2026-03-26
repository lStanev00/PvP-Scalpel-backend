import { wsResponse } from "../helpers/wsResponseHelpers.js";

/**
 * Handle unknown message types with the existing fallback payload.
 *
 * @param {{ send: (payload: string) => unknown }} ws
 * @param {{ type?: unknown }} msg
 * @returns {Promise<void>}
 */
export default async function unknownHandler(ws, msg) {
    wsResponse(ws, "unknown", { receivedType: msg?.type ?? null });
}
