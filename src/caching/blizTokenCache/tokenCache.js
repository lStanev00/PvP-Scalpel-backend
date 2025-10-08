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

export default async function getAccessToken () {
    const tokenUrl = 'https://eu.battle.net/oauth/token';
    const cachedToken = await getToken(); // Check if the token is cached and valid
    if (cachedToken && cachedToken !== null) {
        return cachedToken;
    }
    
    try {
        const response = await fetch(tokenUrl, {
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
        console.info("[Cache] Just cached new Blizzard Access Token.")
        return data.access_token;
    } catch (error) {
        console.error('Error fetching access token:', error);
        throw error;
    }
}