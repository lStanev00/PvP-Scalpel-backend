import validateToken from "../../helpers/authToken.js";
import User from "../../Models/User.js";
import { fingerprintsMatch } from "../../middlewares/authMiddleweare.js";

/**
 * Parse the Cookie header from a WebSocket upgrade request.
 *
 * @param {string | string[] | undefined} cookieHeader
 * @returns {Record<string, string>}
 */
function parseCookieHeader(cookieHeader) {
    const rawHeader = Array.isArray(cookieHeader) ? cookieHeader.join("; ") : cookieHeader;
    if (typeof rawHeader !== "string" || rawHeader.trim().length === 0) return {};

    const cookies = {};

    for (const part of rawHeader.split(";")) {
        const [rawName, ...rawValueParts] = part.split("=");
        const name = rawName?.trim();
        if (!name) continue;

        const rawValue = rawValueParts.join("=").trim();
        try {
            cookies[name] = decodeURIComponent(rawValue);
        } catch {
            cookies[name] = rawValue;
        }
    }

    return cookies;
}

/**
 * Build REST-style auth context for a WebSocket connection.
 *
 * Missing token cookies are accepted as anonymous sockets. Existing but invalid
 * token cookies are rejected so stale or tampered sessions do not continue.
 *
 * @param {import("node:http").IncomingMessage} req WebSocket upgrade request.
 * @returns {Promise<
 *   | { authenticated: false }
 *   | { authenticated: true, JWT: Record<string, unknown>, user: import("../../Models/User.js").default }
 *   | { authenticated: false, authError: string }
 * >}
 */
export default async function getWsAuthContext(req) {
    const cookies = parseCookieHeader(req?.headers?.cookie);
    const token = cookies.token;

    if (!token) return { authenticated: false };

    const auth = validateToken(token, process.env.JWT_SECRET);
    if (!auth) return { authenticated: false, authError: "invalid token" };

    const user = await User.findById(auth._id);
    if (!user) return { authenticated: false, authError: "missing user" };

    if (!fingerprintsMatch(auth.fingerprint, user.fingerprint)) {
        return { authenticated: false, authError: "fingerprint mismatch" };
    }

    return {
        authenticated: true,
        JWT: auth,
        user,
    };
}
