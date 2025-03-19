import achievesData from "./achievesData.js";
import { setToken, getToken } from "./tokenCache.js"

const helpFetch = {
    getAccessToken : async function (clientId, clientSecret) {
        const tokenUrl = 'https://eu.battle.net/oauth/token';

        const cachedToken = getToken(); // Check if the token is cached and valid
        if (cachedToken) {
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
            setToken(data.access_token, data.expires_in);

            return data.access_token;
        } catch (error) {
            console.error('Error fetching access token:', error);
            throw error;
        }
    },
    getCharProfile: async function (server, realm , name, headers ) {
        const URI = `https://${server}.api.blizzard.com/profile/wow/character/${realm}/${name}?namespace=profile-${server}&locale=en_US`;
        try {
            const data = await (await fetch(URI, headers)).json();
            return data
        } catch (error) {
            console.log(error)
        }

    },
    getMedia : async function (data, path, headers) {
        try {
            const data1 = await(await fetch(data[path].key.href, headers)).json();
            try {
                const data2 = await ( await fetch(data1.media.key.href, headers)).json();
                return data2 ? data2.assets[0].value : undefined
                
            } catch (error) {
                return data1.assets[0].value
            }
            
        } catch (error) {
            console.log(error);
            return undefined
        }

    },
    getRating: async function(path, headers, server, name) {
        try {
            const bracketsCheatSheet = {
                "SHUFFLE": `solo`,
                "BLITZ": "solo_bg",
                "ARENA_2v2": "2v2",
                "ARENA_3v3": "3v3",
                "BATTLEGROUNDS": "rbg",
              }
            let result = {
                solo: {
                },
                solo_bg: {
                },
                '2v2': {
                    currentSeason : {
                        rating: 0,
                        title: undefined,
                        seasonMatchStatistics: undefined,
                        weeklyMatchStatistics: undefined
                    },
                    lastSeasonLadder: undefined,
                    record: 0
                },
                '3v3': {
                    currentSeason : {
                        rating: 0,
                        title: undefined,
                        seasonMatchStatistics: undefined,
                        weeklyMatchStatistics: undefined
                    },
                    lastSeasonLadder: undefined,
                    record: 0
                },
                rbg: {
                    rating: undefined,
                    lastSeasonLadder: undefined,
                }
            }
            const brackets = (await (await fetch(path, headers)).json()).brackets;
            for (const bracket of brackets) {
                const data = await ( (await fetch(bracket.href, headers)).json());
                const seasonID = data.season.id;
                const match = (bracket.href).match(/pvp-bracket\/([^?]+)/);
                const bracketName = match[1];
                const pastSeasonCheckURL = `https://${server}.api.blizzard.com/data/wow/pvp-season/${seasonID - 1}/pvp-leaderboard/${bracketName}?namespace=dynamic-${server}&locale=en_US`
                const currentBracket = data.bracket.type;
                const lastSeasonLadder = await helpFetch.getpastRate(pastSeasonCheckURL, name, headers);
                if (currentBracket === `BLITZ` || currentBracket === `SHUFFLE`){
                    const currentSeason = {
                        rating: data.rating,
                        title: await helpFetch.getPvPTitle(data.tier.key.href, headers),
                        seasonMatchStatistics: data.season_match_statistics,
                        weeklyMatchStatistics: data.weekly_match_statistics
                    }
                    const bracketKey = bracketsCheatSheet[currentBracket];
                    if (bracketKey) {
                        result[bracketKey][bracketName] = {
                            currentSeason: currentSeason,
                            lastSeasonLadder: lastSeasonLadder
                        };
                    } else {
                        console.warn(`Unknown bracket: ${currentBracket}`);
                    }
                 } else if(currentBracket == `BATTLEGROUNDS`){
                    const curentBracketData = {
                        rating: data.rating,
                        lastSeasonLadder: lastSeasonLadder,
                    }
                    const bracketKey = bracketsCheatSheet[currentBracket];
                    if (bracketKey) {
                        result[bracketKey] = curentBracketData;
                    } else {
                        console.warn(`Unknown bracket: ${currentBracket}`);
                    }

                 } else {
                    const curentBracketData = {
                        currentSeason : {
                            rating: data.rating,
                            title: await helpFetch.getPvPTitle(data.tier.key.href, headers),
                            seasonMatchStatistics: data.season_match_statistics,
                            weeklyMatchStatistics: data.weekly_match_statistics
                        },
                        lastSeasonLadder: lastSeasonLadder,
                        record: 0
                    }
                    const bracketKey = bracketsCheatSheet[currentBracket];
                    if (bracketKey) {
                        result[bracketKey] = curentBracketData;
                    } else {
                        console.warn(`Unknown bracket: ${currentBracket}`);
                    }
                    
                }


            }
            return result
        } catch (error) {
            return {
                solo: {
                },
                solo_bg: {
                },
                '2v2': {
                    currentSeason : {
                        rating: 0,
                        title: undefined,
                        seasonMatchStatistics: undefined,
                        weeklyMatchStatistics: undefined
                    },
                    lastSeasonLadder: undefined,
                    record: 0
                },
                '3v3': {
                    currentSeason : {
                        rating: 0,
                        title: undefined,
                        seasonMatchStatistics: undefined,
                        weeklyMatchStatistics: undefined
                    },
                    lastSeasonLadder: undefined,
                    record: 0
                },
                rbg: {
                    rating: undefined,
                    lastSeasonLadder: undefined,
                }
            }
        }
    },
    getPvPTitle: async function (href, headers) {
        try {
            const data = await (await fetch(href, headers)).json();
            let result = {
                name: data.name.en_GB,
                media: await helpFetch.getMedia(data, `media`, headers)
            }
            return result
        } catch (error) {
            console.log(error);
            return undefined
        }
    },
    getpastRate: async function (url, playerName, headers) {
        let data;
        try {
            data = await (await fetch(url, headers)).json()
        } catch (error) {
            console.warn(`BAD FETCH`);
        }
        if (!data || !data.entries) {
            console.error('Invalid data format');
            return null;
        }
        playerName = playerName.toLowerCase();

        const player = data.entries.find(entry => entry.character.name.toLowerCase() === playerName);
    
        if (!player) {
            return undefined;
        }

        return {
            rank: player.rank,
            lastSeasonRating: player.rating
        }
    },
    getAchievById : async function (href, headers, statId) {
        let data
        try {
            data = await(await fetch(href ,headers)).json();
        } catch (error) {
            console.warn(`Error fetchng!`)
            return 0
        }
        for (const category of data.categories) {
            for (const subCategory of category.sub_categories || []) {
                for (const stat of subCategory.statistics || []) {
                    if (stat.id === statId) {
                        return stat.quantity;
                    }
                }
            }
        }
        return 0 // Keep 0 if not found
    },
    getAchievXP: async function (href, headers, points) {
        try {
            const data = await (await helpFetch.fetchWithLocale(href, headers)).json();

            const achievementsMAP = new Map();

            for (const element of data.achievements) {
                achievementsMAP.set(element.id, element)
            }            
            const result = await filterAchiev(achievementsMAP, points, headers);
            return result
        } catch (error) {
            console.log(error)
            const result = await filterAchiev(undefined, undefined, undefined);
            return result
        }
    },
    fetchWithLocale: async function (url, options = {}) {
        let apiUrl = new URL(url);
        apiUrl.searchParams.append("locale", "en_US");
      
        return fetch(apiUrl, options);
      },
    getCharMedia: async function (href, headers) {
        try {
            const data = (await( await helpFetch.fetchWithLocale(href, headers)).json()).assets;
            const assets = {
                avatar: (data[0])[`value`],
                banner: (data[1])[`value`],
                charImg: (data[2])[`value`],
            }
            return assets
        } catch (error) {
            console.log(error)
        }
    },
    getCharGear: async function (href, headers) {
        try {
            const data = await (await this.fetchWithLocale(href, headers)).json();
            const result = await formatGearData(data, headers);
            return result
        } catch (error) {
            return undefined
        }
    },
    getStats: async function(href, headers){
        try {
            const data = await(await this.fetchWithLocale(href, headers)).json();
            const result = extractStats(data);
            return result
        } catch (error) {
            console.log(error);
            return undefined
        }
    }
}


async function filterAchiev (achievements, points, headers) {
    let result = {
        points: points.points, // Collected
        "2s": {
            name: undefined
        },
        "3s": {
            name: undefined
        },
        solo: {
            name:undefined
        },
        RBG: {
            XP: {
                name: undefined,
            },
            WINS: {
                name: undefined
            }
        },
        Blitz: {
            XP: {
                name: undefined,
            },
            WINS: {
                name: undefined
            }
        },
    }
    if (!achievements) return result
    // Get the 2s XP
    for (const {key, name: dataName, id: dataID} of achievesData["2v2"]) {
        let match = achievements.get(dataID)
        if (match && match?.completed_timestamp){
            try {
                const data = await(await helpFetch.fetchWithLocale(match.achievement.key.href, headers)).json();
                const twosResult = {
                    name: data.name,
                    description: data.description,
                    media: await helpFetch.getMedia(data, "media", headers)
                }
                result["2s"] = twosResult;
            } catch (error) {
                console.log(error);
            }
            break;  
        }
    }
    // Get the 3s XP
    for (const {key, name: dataName, id: dataID} of achievesData["3v3"]) {
        let match = achievements.get(dataID);
        if (match && match?.completed_timestamp){
            try {
                const data = await(await helpFetch.fetchWithLocale(match.achievement.key.href, headers)).json();
                const threesResult = {
                    name: data.name,
                    description: data.description,
                    media: await helpFetch.getMedia(data, "media", headers)
                }
                result["3s"] = threesResult;
            } catch (error) {
                console.log(error);
            }
            break;  
        }
    }
    // Get the soloShuffle XP
    for (const {key, name, id: dataID} of achievesData["soloShuffle"]) {
        let match = achievements.get(dataID);
        if (match && match?.completed_timestamp) try {
            const data = await(await helpFetch.fetchWithLocale(match.achievement.key.href, headers)).json();
            const soloResult = {
                name: data.name,
                description: data.description,
                media: await helpFetch.getMedia(data, "media", headers)
            }
            result["solo"] = soloResult;
            break;
        } catch (error) {
            console.log(error); break;
        }
    }
    // Get RBG & Blitz XP!
    for (const {key, name, id: dataID} of achievesData["BG"]) {
        let match = achievements.get(dataID);
        if (match && match?.completed_timestamp) try {
            const data = await(await helpFetch.fetchWithLocale(match.achievement.key.href, headers)).json();
            const BGXPResult = {
                name: data.name,
                description: data.description,
                media: await helpFetch.getMedia(data, "media", headers)
            }
            result["RBG"].XP = BGXPResult;
            result["Blitz"].XP = BGXPResult;
            break;
        } catch (error) {
            console.log(error); break;
        }
    }
    // Get the RBG WINS
    for (const {key, name, id: dataID} of achievesData["RBGWins"]) {
        let match = achievements.get(dataID);
        if (match && match?.completed_timestamp) try {
            const data = await(await helpFetch.fetchWithLocale(match.achievement.key.href, headers)).json();
            const RBGWinsResult = {
                name: data.name,
                description: data.description,
                media: await helpFetch.getMedia(data, "media", headers)
            }
            result["RBG"].WINS = RBGWinsResult;
            break;
        } catch (error) {
            console.log(error); break;
        }
    }

    let strategistChecker = undefined;
    try {
        const URI = `https://eu.api.blizzard.com/data/wow/achievement-category/15270?namespace=static-11.1.0_59095-eu&locale=en_US`
        strategistChecker = await(await fetch(URI, headers)).json();
        strategistChecker = (strategistChecker.achievements)
            .filter(ach => ach.name.startsWith("Strategist: "))
            .sort((a, b) => {
                const aCheck = Number(a.name.replace("Strategist: The War Within Season ", ""));
                const bCheck = Number(b.name.replace("Strategist: The War Within Season ", ""));
                
                return bCheck - aCheck;
            });
    } catch (error) {
        console.log(error);
    }
    if (strategistChecker) {
        for (const {  key, name, id: dataID  } of strategistChecker) {
            let match = achievements.get(dataID);

            if(match && match?.completed_timestamp) {
                try {
                    const data = await(await helpFetch.fetchWithLocale(match.achievement.key.href, headers)).json();
                    const BlitzWinsResult = {
                        name: data.name,
                        description: data.description,
                        media: await helpFetch.getMedia(data, "media", headers)
                    }
                    result["Blitz"].WINS = BlitzWinsResult;
                    return result // Return to bypass the next check
                } catch (error) {
                    console.log(error); break;
                }
            }
        }
    }
    // Get the Blitz WINS
    for (const {key, name, id: dataID} of achievesData["BlitzWins"]) {
        let match = achievements.get(dataID);
        if (match && match?.completed_timestamp)
            try {
                const data = await(await helpFetch.fetchWithLocale(match.achievement.key.href, headers)).json();
                const BlitzWinsResult = {
                    name: data.name,
                    description: data.description,
                    media: await helpFetch.getMedia(data, "media", headers)
                }
                result["Blitz"].WINS = BlitzWinsResult;
                break;
            } catch (error) {
                console.log(error); break;
            }
    }
    return result
}

async function formatGearData(apiResponse, headers) {
    const gear = {};

    for (const item of apiResponse.equipped_items) {
        let slot = item.slot.type.toLowerCase();

        // Handle mismatches in slot names between API and schema
        const slotMap = {
            "cloak": "clock",
            "main_hand": "wep",
            "off_hand": "offHand",
            "finger_1": "ring1",
            "finger_2": "ring2",
            "trinket_1": "trinket1",
            "trinket_2": "trinket2",
        };
        slot = slotMap[slot] || slot;

        const media = await helpFetch.getMedia(item, "media", headers);

        const sockets = item.sockets
            ? await Promise.all(
                  item.sockets.map(async (socket) => ({
                      gemName: socket.item.name,
                      gemId: socket.item.id,
                      media: await helpFetch.getMedia(socket, "media", headers),
                      bonus: socket.display_string,
                  }))
              )
            : [];

        gear[slot] = {
            name: item.name,
            id: item.item.id,
            media,
            level: item.level?.value || 0,
            stats: item.stats?.map((stat) => ({
                type: stat.type.name,
                value: stat.value,
            })) || [],
            sockets,
            enchantments: item.enchantments?.map((enchant) => ({
                description: enchant.display_string,
                id: enchant.enchantment_id,
            })) || [],
            transmog: item.transmog
                ? {
                      name: item.transmog.item.name,
                      id: item.transmog.item.id,
                  }
                : null,
        };
    }

    return gear;
}

function extractStats(data) {
    let primaryStat = ["Unknown", 0];
    const stats = {
        Strength: data?.strength?.effective,
        Agility: data?.agility?.effective,
        Intellect: data?.intellect?.effective
    };
    for (let [key, value] of Object.entries(stats)) {
        if (value > primaryStat[1]) {
            primaryStat = [key, value];
        }
    }

    
    return {
        Primary: primaryStat,
        Stamina: data?.stamina?.effective || 0,
        Armor: data?.armor?.effective || 0,
        Versatility: `${data?.versatility_damage_done_bonus?.toFixed(1) || "0"}%`,
        Haste: `${data?.melee_haste?.value?.toFixed(1) || data?.ranged_haste?.value?.toFixed(1) || "0"}%`,
        Mastery: `${data?.mastery?.value?.toFixed(1) || "0"}%`,
        CriticalStrike: `${data?.melee_crit?.value?.toFixed(1) || data?.ranged_crit?.value?.toFixed(1) || "0"}%`,
        Speed: `${data?.speed?.rating_bonus?.toFixed(1) || "0"}%`,
        Leech: `${data?.lifesteal?.value?.toFixed(1) || "0"}%`,
        Dodge: `${data?.dodge?.value?.toFixed(1) || "0"}%`,
        Parry: `${data?.parry?.value?.toFixed(1) || "0"}%`,
        Block: `${data?.block?.value?.toFixed(1) || "0"}%`,
        Avoidance: `${data?.avoidance?.value?.toFixed(1) || "0"}%`
    };
    
}

export default helpFetch