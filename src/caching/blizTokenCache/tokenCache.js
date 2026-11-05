import { configDotenv } from "dotenv";
import getCache from "../../helpers/redis/getterRedis.js";
import setCache from "../../helpers/redis/setterRedis.js";
configDotenv();

const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;
const hashName = "blizzardAPIAccessToken";

async function setToken(token, expiresIn) {
    await setCache("cachedToken", token, hashName);
    expiresIn = Date.now() + expiresIn * 1000 - 60000;
    await setCache("tokenExpiry", expiresIn, hashName);
}

async function getToken() {
    const cachedToken = await getCache("cachedToken", hashName);
    const tokenExpiry = await getCache("tokenExpiry", hashName);
    if (cachedToken && tokenExpiry > Date.now()) {
        return cachedToken;
    }
    return null;
}

/**
 * Reads the cached token or requests one with a 20-second HTTP deadline.
 * @param {AbortSignal} [signal] - Optional cancellation signal from the API caller.
 * @returns {Promise<string>} Blizzard access token.
 */
export default async function getAccessToken (signal = undefined) {
    signal?.throwIfAborted();
    const tokenUrl = 'https://eu.battle.net/oauth/token';
    const cachedToken = await getToken(); // Check if the token is cached and valid
    signal?.throwIfAborted();
    if (cachedToken && cachedToken !== null) {
        return cachedToken;
    }
    
    try {
        const timeoutSignal = AbortSignal.timeout(20_000);
        const response = await fetch(tokenUrl, {
            signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
            },
            body: 'grant_type=client_credentials',
        });

        if (!response.ok) {
            throw new Error(`!! Failed to fetch token: ${response.statusText}`);
        }

        const data = await response.json();
        await setToken(data.access_token, data.expires_in);
        return data.access_token;
    } catch (error) {
        console.error('Error fetching access token:', error);
        throw error;
    }
}
