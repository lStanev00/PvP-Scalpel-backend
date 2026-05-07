export const productionUrl = "https://api.pvpscalpel.com/";
export const publicTestUrl = "https://pvp-scalpel-frontend-production.up.railway.app";

const allowedOrigins = [
    "https://pvpscalpel.com",
    "https://www.pvpscalpel.com",
    "https://app.pvpscalpel.com",
    "https://guid.pvpscalpel.com",
    productionUrl,
    publicTestUrl,
    "http://localhost:5173",
    "http://localhost:1420",
    "http://tauri.localhost",
];

export function isAllowedOrigin(origin) {
    return !origin || allowedOrigins.includes(origin);
}

export const corsOptions = {
    origin: (origin, callback) => {
        if (isAllowedOrigin(origin)) {
            callback(null, true);
        } else {
            callback(null, false);
        }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "token", "cache-control", "cache", "600", "desktop"],
    optionsSuccessStatus: 204,
};
