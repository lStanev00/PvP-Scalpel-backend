/**
 * Normalize a socket or forwarded IP address for logging.
 * Converts IPv6-mapped IPv4 values like `::ffff:127.0.0.1` to `127.0.0.1`.
 *
 * @param {string | null | undefined} address
 * @returns {string | null}
 */
export function normalizeAddress(address) {
    if (typeof address !== "string" || address.length === 0) return null;
    if (address.startsWith("::ffff:")) return address.slice(7);
    return address;
}

/**
 * Build a compact connection log context from the incoming WebSocket upgrade request.
 * Prefers proxy headers when present and falls back to the raw socket address.
 *
 * @param {{
 *   headers: {
 *     ["x-forwarded-for"]?: string | string[] | undefined,
 *     ["x-real-ip"]?: string | string[] | undefined,
 *     origin?: string | string[] | undefined
 *   },
 *   socket: { remoteAddress?: string | undefined },
 *   url?: string | undefined
 * }} req
 * @returns {{
 *   ip: string,
 *   viaProxy: boolean,
 *   origin: string | string[] | null,
 *   url: string | null
 * }}
 */
export function getConnectionLogContext(req) {
    const forwardedForHeader = req.headers["x-forwarded-for"];
    const realIpHeader = req.headers["x-real-ip"];

    const forwardedFor = typeof forwardedForHeader === "string"
        ? forwardedForHeader
            .split(",")
            .map((entry) => normalizeAddress(entry.trim()))
            .filter(Boolean)
        : [];

    const realIp = typeof realIpHeader === "string"
        ? normalizeAddress(realIpHeader.trim())
        : null;

    const socketIp = normalizeAddress(req.socket.remoteAddress);
    const clientIp = forwardedFor[0] ?? realIp ?? socketIp ?? "unknown";

    return {
        ip: clientIp,
        viaProxy: forwardedFor.length > 0 || realIp !== null,
        origin: req.headers.origin ?? null,
        url: req.url ?? null,
    };
}
