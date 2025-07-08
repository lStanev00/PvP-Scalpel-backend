export const productionUrl = "https://api.pvpscalpel.com/"

const allowedOrigins = [
  "https://pvpscalpel.com",
  "https://www.pvpscalpel.com",
  "https://app.pvpscalpel.com",
  "https://guid.pvpscalpel.com",
  productionUrl,
  "http://localhost:5173" // If needed for local development
];

export const corsOptions = {
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(null, false);
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'token', 'cache-control', 'cache', '600'],
    optionsSuccessStatus: 204
};