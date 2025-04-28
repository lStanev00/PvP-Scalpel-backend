import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';

// PLEASE NOTE! Blizzard API have 36,000 requests per hour at a rate of 100 requests per second LIMIT!.

//THIS QUERY does 1303 requests for 100 PLAYERS and runs on every 40 MINUTES

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
  
        credentials: "include", // always include cookies
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
  async function fetchPvPData(realm, name) {
    // const charString = `${characterClass.toLowerCase().replace(` `, ``)}-${spec.toLowerCase()}`;
  
    const brackets = {
      "SHUFFLE": `solo`,
      "BLITZ": "solo_bg",
      "ARENA_2v2": "2v2",
      "ARENA_3v3": "3v3",
      "BATTLEGROUNDS": "rbg",
    };
  
    try {
        const results = {};
        
        const url = `https://eu.api.blizzard.com/profile/wow/character/${realm}/${(name).toLowerCase()}/pvp-summary?namespace=profile-eu&locale=en_US&locale=en_US`;
        const header = {
            headers: {
              Authorization: `Bearer ${accessToken}`, // Use header for authentication
              'Cache-Control': 'no-cache',  // prevents cached responses
              'Pragma': 'no-cache',
            }
        }

        var baracketsData = await (await fetch(url, header)).json();
            // console.log(baracketsData)
          for (const { href } of baracketsData.brackets) {
            const hrefData = await (await fetch(href + `&locale=en_US`, header)).json();
            const bracketType = hrefData.bracket.type;
            const rating  = Number(hrefData.rating);
            const playerLastSeason = hrefData.season.id;

            if(playerLastSeason == currentSeason) results[`${brackets[bracketType]}`] = rating;
          }
          console.log(results);

          console.log(`Player: ${baracketsData.character.name} has: ` + results)

          
        return results;
    } catch (error) {
        if (!(baracketsData.bracket)){
            console.log(`Player: ${baracketsData.character.name} has no data`)
        } else {

            console.log(error)
        }
        
    }
    // for (const [key, value] of Object.entries(brackets)) {
    //   const data = await blizzFetch(`/profile/wow/character/${realm}/${name}/pvp-bracket/${value}?`, name, key);
    //   results[key] = data?.rating || undefined;
  
    //   if (results[key] === undefined) continue;
    //   let playerLastSeason = data.season.id;
      
    //   if(playerLastSeason != currentSeason) results[key] = undefined;
    // }


  
  }
  async function fetchPvPAchievements(region, realm, characterName, accessToken) {
    const characterAchievementsUrl = `https://${region}.api.blizzard.com/profile/wow/character/${realm}/${characterName}/achievements?namespace=profile-${region}&locale=en_GB`;
    const achievementDetailUrl = (id) =>
        `https://${region}.api.blizzard.com/data/wow/achievement/${id}?namespace=static-${region}&locale=en_GB`;

    // Arena achievements
    const arena2sAchievements = ["Gladiator", "Duelist", "Rival", "Challenger"];
    const arena3sAchievements = [
        "Three's Company: 2700", "Three's Company: 2400", "Three's Company: 2200",
        "Three's Company: 2000", "Three's Company: 1750", "Three's Company: 1550"
    ];

    // Full Battleground achievements list
    const battlegroundAchievements = [
        "Veteran of the Alliance", "Battleground Blitzest", "Warbound Veteran of the Alliance", "High Warlord",
        "Hero of the Alliance", "Hero of the Horde", "Grand Marshal", "Veteran of the Horde", "General",
        "Knight-Lieutenant", "Knight-Captain", "Knight-Champion", "Sergeant Major", "Master Sergeant",
        "Battleground Blitz Veteran", "Battleground Blitz Master", "Setting Records", "Battle-scarred Battler", 'Legionnaire', `Champion`,
        `Lieutenant Commander`, `Commander`, `Lieutenant General`, `Marshal`, `Field Marshal`, `Warlord`, "Stone Guard"
    ];

    try {
        // Step 1: Fetch character achievements
        const response = await fetch(characterAchievementsUrl, {
            headers: { Authorization: `Bearer ${accessToken}` },
            'Cache-Control': 'no-cache',  // prevents cached responses
            'Pragma': 'no-cache',
        });

        if (!response.ok) throw new Error(`Error fetching character achievements: ${response.status}`);
        const charData = await response.json();
        const completedAchievements = charData.achievements;

        // Step 2: Fetch achievement details with rate limiting
        const achievementDetails = [];
        for (const ach of completedAchievements) {
            if (
                arena2sAchievements.includes(ach.achievement.name) ||
                arena3sAchievements.includes(ach.achievement.name) ||
                battlegroundAchievements.includes(ach.achievement.name)
            ) {
                // await delay(5); 
                const detailResponse = await fetch(achievementDetailUrl(ach.achievement.id), {
                    headers: { Authorization: `Bearer ${accessToken}` },
                });

                if (detailResponse.ok) {
                    const detail = await detailResponse.json();
                    achievementDetails.push({
                        name: detail.name,
                        description: detail.description || "No description",
                    });
                }
            }
        }

        // Step 3: Filter 2v2 Arena achievements
        const arena2s = achievementDetails
            .filter((ach) => arena2sAchievements.includes(ach.name))
            .pop() || `No XP yet`;

        // Step 4: Filter 3v3 Arena achievements
        const arena3s = achievementDetails
            .filter((ach) => arena3sAchievements.includes(ach.name))
            .pop() || `No XP yet`;

        // Step 5: Filter Battleground achievements
        const bgAchievements = [];
        let bestRatingAchievement = { name: "None", description: "" };
        let maxRating = 0;

        for (const ach of achievementDetails) {
            if (battlegroundAchievements.includes(ach.name)) {
                // Look for rating achievements in the description
                const ratingMatch = ach.description.match(/Earn a rating of (\d+)/);
                if (ratingMatch) {
                    const rating = parseInt(ratingMatch[1], 10);
                    if (rating > maxRating) {
                        maxRating = rating;
                        bestRatingAchievement = ach;
                    }
                } else {
                    bgAchievements.push(ach); // Push non-rating BG achievements
                }
            }
        }

        if (bestRatingAchievement.name !== "None") {
            bgAchievements.push({
                name: bestRatingAchievement.name,
                description: bestRatingAchievement.description,
            });
        }

        // Step 6: Return the results
        const result = {
            "2s": arena2s,
            "3s": arena3s,
            "BG": bgAchievements,
        };
        if (result[`2s`] === undefined) delete result[`2s`];
        if (result[`3s`] === undefined) delete result[`3s`];
        if (result[`BG`].length === 0) delete result[`BG`];
        // console.log(` PvP Achievements for ${characterName} are fetched`);
        return result;
    } catch (error) {
        console.error(`Error fetching PvP achievements for ${characterName}:`, error.message);
        return {
            "2s": { name: "None", description: "" },
            "3s": { name: "None", description: "" },
            "BG": [],
        };
    }
}
// https://eu.api.blizzard.com/profile/wow/character/chamber-of-aspects/nikolbg/character-media?namespace=profile-eu ??TEST
async function fetchImage(server, name, realm, token) {
    const URL = `https://${server}.api.blizzard.com/profile/wow/character/${realm}/${name.toLowerCase()}/character-media?namespace=profile-${server}`;

    try {
        const data = await(await fetch(URL, {
            headers: {
                Authorization: `Bearer ${token}`,
                'Cache-Control': 'no-cache',  // prevents cached responses
                'Pragma': 'no-cache',
            }
        })).json();
        const assets = data.assets;       
        const media = {
            avatar: (assets[0])[`value`],
            banner: (assets[1])[`value`],
            charImg: (assets[2])[`value`],
        }
        // console.log(`Media success!`);
        
        return media
    } catch (error) {
        console.log(`Cant retreve media`);
        
    }
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
  async function fetchCharacterData(member) {
    const { name, realm } = member.character;
    const playerRealmSlug = realm.slug.toLowerCase();
    const playerNameSlug = name.toLowerCase();

    // const req = await fetch(`https://api.pvpscalpel.com/checkCharacter/eu/${playerRealmSlug}/${name}`, {
    //   method: "GET",
    //   headers: {
    //     "600": "BasicPass"
    //   }
    // })

    // const reqData = await req.json();
    // console.log(req.data)
  
    // Fetch character profile
    // await delay(5); 
    const characterProfile = await blizzFetch(
      `/profile/wow/character/${playerRealmSlug}/${playerNameSlug}?`,
      name,
      "Profile"
    );
  
    if (!characterProfile) {
  
      console.log(`Player "${name}" has no character profile. Slugs:` + ` Realm - ` + playerRealmSlug + ` Name - ` + playerNameSlug);
      return null;
    }
  
    // Fetch PvP ratings
    const playerPvPData = await fetchPvPData(
      playerRealmSlug,
      playerNameSlug,
      characterProfile.character_class.name,
      characterProfile.active_spec?.name || "Unknown"
    );
    
  //   console.log(`THIS IS ERRORING HERE:`, `eu`, (name).toLowerCase(), playerRealmSlug, ACCESS_TOKEN);


    
    return {
      name,
      playerRealmSlug,
      blizID : member.character["id"],
      rank: member.rank,
      race: characterProfile.race?.name || "Unknown",
      class: characterProfile.character_class?.name || "Unknown",
      spec: characterProfile.active_spec?.name || "Unknown",
      rating: playerPvPData,
      achieves : await fetchPvPAchievements(`eu`, playerRealmSlug, (name).toLowerCase(), accessToken),
      media: await fetchImage(`eu`, (name).toLowerCase(), playerRealmSlug, accessToken),
    };
  }


  async function getGuildPvPData() {
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
  
    console.log("Fetching PvP data for each guild member...");
    // let results = [];
    for (const member of members) {
      // console.log(member);
      const realmSlug = member?.character.realm?.slug;
      const playerName = member?.character.name;
      console.log(realmSlug, playerName)
      await delay(1000)

      const req = await fetchDBMS(`/patchCharacter/eu/${realmSlug}/${playerName}`,{
        method: "PATCH"
      });
      // console.log(req.status)
      // const playerData = await fetchCharacterData(member);
      // if (playerData) {
      //   results.push(playerData);
      // }
    }
  
    // // Sort by rank
    // results = results.sort((a, b) => a.rank - b.rank);
    // let success = 0;
    // let fails = 0;

    // for (const entry of results) {
    //   try {
    //     // const member = { name, playerRealmSlug, blizID, rank, race, class, spec, rating, achieves, media }
    //     const member = entry
    //     const token = jwt.sign(member, JWT_SECRET, { expiresIn: "20s" });
    //     const DBMSreq = await fetch(`http://localhost:59534/member`, {
    //       method: `POST`,
    //       headers: {
    //         "Content-Type": "application/json",
    //         "in-auth": `${token}`,
    //         "600": "BasicPass"
    //       },
    //     })
    //     if (DBMSreq.status >= 500 || DBMSreq.status == 401){
    //       console.log(member.name);
    //       fails = fails + 1;
    //     } else {
    //         success = success + 1;
    //     }
        
    //   } catch (error) {
    //     console.error("Error saving PvP data:", error.message);
    //   }
    // }
    // console.log(`PvP data successfully!\nSuccess: ${success}\nFails: ${fails}`);
  };

  getGuildPvPData();
  setInterval(getGuildPvPData, 2400000); // Close to 40 minutes refresh rate

// TEST WITH 1 FETCH
  async function getOneMemberPvPData() {
    // Get and store access token and season
    accessToken = await getAccessToken();
    currentSeason = await getSeason();
    const now = new Date();
    console.log(`Execution Time: ${now.toLocaleDateString()} ${now.toLocaleTimeString()}`);
  
    console.log("Fetching guild roster...");
    const guildRoster = await blizzFetch(
      `/data/wow/guild/${GUILD_REALM}/${GUILD_NAME}/roster?`,
      "Guild",
      "Roster"
    );
  
    if (!guildRoster || !guildRoster.members) {
      throw new Error("Failed to fetch guild roster.");
    }
  
    // For testing, fetch data for only one member (e.g., the first member)
    let member = await (await fetch(`https://eu.api.blizzard.com/profile/wow/character/chamber-of-aspects/nikolbg?namespace=profile-eu&locale=en_US`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      'Cache-Control': 'no-cache',  // prevents cached responses
      'Pragma': 'no-cache',
  })).json();
    // console.log(member);

    member = {
      character : member
    }
    
    console.log(`Fetching PvP data for ${member.character.name}...`);
  
    const playerData = await fetchCharacterData(member);
    if (!playerData) {
      console.log(`No PvP data for ${member.character.name}`);
      return;
    }
  
    try {
      // Create a short-lived JWT for this member's data
      const token = jwt.sign(playerData, JWT_SECRET, { expiresIn: "20s" });
    //   console.log(token)
      debugger;
      const DBMSreq = await fetch(`http://localhost:59534/member`, {
        method: `POST`,
        headers: {
          "Origin": "https://pvpscalpel.com",
          "Content-Type": "application/json",
          "in-auth": `${token}`,
          'Cache-Control': 'no-cache',  // prevents cached responses
          'Pragma': 'no-cache',
        },
      });
      console.log(await DBMSreq.json());

      
      if (DBMSreq.status >= 500 || DBMSreq.status === 401) {
        console.log("Error saving PvP data for:", playerData);
      } else {
        console.log("PvP data saved successfully for:", playerData.name);
      }
    } catch (error) {
      console.error("Error saving PvP data:", error.message);
    }
  }
  
  // For testing, call the function that fetches data for one member only
  // getOneMemberPvPData();
  