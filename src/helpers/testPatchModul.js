import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';

// PLEASE NOTE! Blizzard API have 36,000 requests per hour at a rate of 100 requests per second LIMIT!.

dotenv.config({ path: '../../../../.env' });
const JWT_SECRET = process.env.JWT_SECRET;
// Token storing
let accessToken = null;
let tokenExpiry = null; // Store the expiration timestamp

// Blizzard API credentials
const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;
const tokenUrl = 'https://eu.battle.net/oauth/token';

// Blizzard API Configuration
const REGION = "eu";
const GUILD_REALM = "chamber-of-aspects"; // Guild's realm slug
const GUILD_NAME = "pvp-scalpel"; // Guild name slugified
const BASE_URL = `https://${REGION}.api.blizzard.com`;
const NAMESPACE = "profile-eu";

// Store the current PvP Season
let currentSeason = null;

// Helper function for delay
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Helper function to fetch data with retry logic
async function blizzFetch(endpoint, playerName, bracket, retries = 3) {
    const url = `${BASE_URL}${endpoint}&namespace=${NAMESPACE}&locale=en_GB`;
  
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${accessToken}`, // Use header for authentication
            'Cache-Control': 'no-cache',  // prevents cached responses
            'Pragma': 'no-cache',
          },
        });
        // console.log(accessToken)
        if (response.ok) {
          return await response.json();
        }
  
        if (response.status === 503) {
          console.log(
            `Blizzard API unavailable (503). Retry ${attempt}/${retries} for ${playerName} in ${bracket}...`
          );
          await delay(5); // Wait before retrying
        } else {
          if (response.status != 404) console.log(`Player "${playerName}" has no data for ${bracket}. Status: ${response.status}`);
          return null; // Non-retriable errors
        }
      } catch (error) {
        console.log(`Error fetching data for ${playerName} in ${bracket}: ${error.message}`);
        if (attempt < retries) {
          console.log(`Retry ${attempt}/${retries} after error...`);
          await delay(5); // Wait before retrying
        } else {
          throw error; // Give up after retries
        }
      }
    }
  
    return null; // Return null if all retries fail
  }

  async function fetchDBMS(endpoint, options = {}) {
    // const apiDomain = "https://api.pvpscalpel.com";
    const url = `http://localhost:59534`
    const defaultOptions = {
  
        // credentials: "include", // always include cookies
        headers: {
          "600": "BasicPass",
          "Content-Type": "application/json",
          ...options.headers,
          cache: 'no-store',
        },
    };

    const finalOptions = { ...defaultOptions, ...options };

    return fetch(url + endpoint, finalOptions)
  }

// Function to dynamically fetch the access token
async function getAccessToken() {
    const now = Date.now();

    // Check if the token is still valid
    if (accessToken && tokenExpiry && now < tokenExpiry) {
        return accessToken;
    }

    try {
        const response = await fetch(tokenUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
                'Cache-Control': 'no-cache',  // prevents cached responses
                'Pragma': 'no-cache',
            },
            body: 'grant_type=client_credentials',
        });

        if (!response.ok) {
            throw new Error(`!! Failed to fetch token: ${response.statusText}`);
        }

        const data = await response.json();

        // Store the token and calculate its expiration time
        accessToken = data.access_token;
        tokenExpiry = now + data.expires_in * 1000;

        console.log('>> New token fetched:', accessToken);
        return accessToken;
    } catch (error) {
        console.error('Error fetching access token:', error);
        throw error;
    }
}

async function getSeason() {
    const seasonURL = `https://eu.api.blizzard.com/data/wow/pvp-season/index?namespace=dynamic-eu&locale=en_US`;

    try {
        const req = await fetch(seasonURL, {
            headers: { Authorization: `Bearer ${accessToken}` },
            'Cache-Control': 'no-cache',  // prevents cached responses
            'Pragma': 'no-cache',
        });

        if (!req.ok) throw new Error(`Error getting curent season: ${response.status}`);

        const data = await req.json();

        return data.current_season.id
    } catch (error) {
        console.log(`Can't get season ERRORED: ${error}`);
    }
}

  export async function getGuildMembers() {
    // Get and store access token and season
    accessToken = await getAccessToken()
    currentSeason = await getSeason();
    // currentSeason = 39
    const now = new Date(); 
    console.log(`Execution Time: ${now.toLocaleDateString()} ${now.toLocaleTimeString()}`);

    console.log("Fetching guild roster...");
    const guildRoster = await blizzFetch(`/data/wow/guild/${GUILD_REALM}/${GUILD_NAME}/roster?`, "Guild", "Roster");
  
    if (!guildRoster || !guildRoster.members) {
      throw new Error("Failed to fetch guild roster.");
    }
  
    const members = guildRoster.members;
    console.log(members[0].character)
    return members

  
    console.log("Fetching PvP data for each guild member...");

    for (const member of members) {

      const realmSlug = member?.character.realm?.slug;
      const playerName = member?.character.name;
      console.log(realmSlug, playerName)
      await delay(1000)

      const req = await fetchDBMS(`/patchCharacter/eu/${realmSlug}/${playerName}`,{
        method: "PATCH"
      });
    }
  };

  // getGuildMembers();
  // setInterval(getGuildMembers, 3400000);

// TEST WITH 1 FETCH
  async function getOneMemberPvPData(server, realmSlug, playerName) {
    // Get and store access token and season
    accessToken = await getAccessToken();
    currentSeason = await getSeason();
    const now = new Date();
    console.log(`Execution Time: ${now.toLocaleDateString()} ${now.toLocaleTimeString()}`);

    const req = await fetchDBMS(`/patchCharacter/${server}/${realmSlug}/${playerName}`,{
      method: "PATCH"
    });

  }
  
  // For testing, call the function that fetches data for one member only
  // getOneMemberPvPData();
  