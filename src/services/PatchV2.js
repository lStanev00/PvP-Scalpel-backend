import dotenv from 'dotenv';
import Char from '../Models/Chars.js';
import { buildCharacter } from '../controllers/characterSearchCTRL.js';
import fetchData from '../helpers/blizFetch.js';
import helpFetch from '../helpers/blizFetch-helpers/endpointFetchesBliz.js';
import Service from '../Models/Services.js';
dotenv.config({ path: '../../../../.env' });

// PLEASE NOTE! Blizzard API have 36,000 requests per hour at a rate of 100 requests per second LIMIT!

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
    const port = process.env.PORT || 8080;
    const url = `http://localhost:${port}`
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

        // console.log('>> New token fetched:', accessToken);
        return accessToken;
    } catch (error) {
        console.error('Error fetching access token:', error);
        throw error;
    }
}

export async function findChar(server, realm, name) {
    let character = undefined;
    
    try {
        character = await Char.findOne({
            name: name,
            "playerRealm.slug": realm,
            server: server
        })
        if(character) return character
    } catch (error) {
        console.warn(error)
    }
    return null
    
}

  export async function updateGuildMembersData() {
    // Get and store access token and season
    accessToken = await getAccessToken()
    const now = new Date(); 
    const fullUpdate = await checkIfShouldUpdateFull();
    console.info(`Full update? = ${fullUpdate}`)
    console.log(`Execution Time: ${now.toLocaleDateString()} ${now.toLocaleTimeString()}`);

    console.log("Fetching guild roster...");
    const guildRoster = await blizzFetch(`/data/wow/guild/${GUILD_REALM}/${GUILD_NAME}/roster?`, "Guild", "Roster");
  
    if (!guildRoster || !guildRoster.members) {
      throw new Error("Failed to fetch guild roster.");
    }
  
    const members = guildRoster.members;
  
    console.log("Fetching PvP data for each guild member...");
    let delayMS = 500;

    for (const member of members) {
        
        const server = "eu";
        const realm = member?.character.realm?.slug;
        const name = member?.character.name;
        let character = await findChar(server, realm, name);
        if(!character) character = await buildCharacter(server, realm, name);
        
        await delay(delayMS);
        
        if(fullUpdate) {
            if(!character) {
                console.warn(`The character update failed with credentials:\n${server} ${realm} ${name}`)
            } else {
    
                const checkedCount = character.checkedCount;
                const charID = character._id;
    
                try {
                    const updatedData = await fetchData(server, realm, name);
                    updatedData.checkedCount = checkedCount;
                        character = await Char.findByIdAndUpdate(charID, {
                            $set: updatedData
                        }, {new: true}
                    )
                    
                } catch (error) {
                    console.warn(error)
                }
            }
            // if (character.name == name) {
            //     console.info(name)
            // }
            continue
        } else {
            
            try {
                const PvPData = await helpFetch.getRating(undefined, undefined, undefined, server, realm, name);
                const updatedCharPvpData = await Char.findByIdAndUpdate(character._id, {
                    rating: PvPData
                }, {timestamps: false});

            } catch (error) {
                console.warn(error);
            }

      }


    }


    const endNow = new Date();
    const runtimeMS  = endNow.getTime() - now.getTime();

    try {
        
        const serviceUpdate = await Service.findOneAndUpdate(
            {
                service: "PatchPvP"
            }, {
                $set: {
                    lastRun: endNow,
                    running: false
                },
                $push: {
                    msRecords: runtimeMS
                }
            }, {
                new: true
            }
        )
        console.log(`Update succeed: ${now.toLocaleDateString()} ${endNow.toLocaleTimeString()}`);
    
        return serviceUpdate;
    } catch (error) {

        return null;
        
    }
    
};
  // updateGuildMembersData();
  // setInterval(updateGuildMembersData, 3600000); // Runs every hour

// TEST WITH 1 FETCH
  async function getOneMemberPvPData(server, realmSlug, playerName) {
    // Get and store access token and season
    accessToken = await getAccessToken();
    const now = new Date();
    console.log(`Execution Time: ${now.toLocaleDateString()} ${now.toLocaleTimeString()}`);

    const req = await fetchDBMS(`/patchCharacter/${server}/${realmSlug}/${playerName}`,{
      method: "PATCH"
    });

  }
  
  // For testing, call the function that fetches data for one member only
  // getOneMemberPvPData();
  

async function checkIfShouldUpdateFull() {
    const twentyFourHours = 24 * 60 * 60 * 1000;
    const nowMS = new Date().getTime();
    let serviceData = undefined;

    try {
        serviceData = await Service.findOne({service: "PatchPvP"});
        
    } catch (error) {}

    if(!serviceData) {

        try {
            const newService = new Service({
                service: "PatchPvP",
                running: true,
            });

            await newService.save();
            serviceData = await Service.findOne({service: "PatchPvP"});

        } catch (error) {
            console.warn(error)
            
        }
    }

    const lastRun = serviceData?.lastRun;

    if(lastRun === null || !lastRun) return true

    const lastMS = lastRun ? lastRun.getTime() : 0;

    return (nowMS - lastMS >= twentyFourHours);
}
