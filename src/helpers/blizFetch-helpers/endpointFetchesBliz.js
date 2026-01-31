import achievesData from "./achievesData.js";
import {delay} from "../startBGTask.js";
import Achievement from "../../Models/Achievements.js";
import { getSeasonalIdsMap, setSeasonalIdsMap } from "../../caching/achievements/achievesEmt.js";
import dotenv from 'dotenv';
import BlizAPIError from "../../Models/BlizAPIErrors.js";
import getAccessToken from "../../caching/blizTokenCache/tokenCache.js";
dotenv.config({ path: '../../../.env' });

const helpFetch = {
    getCharProfile: async function (server, realm , name) {
        const URI = `https://${server}.api.blizzard.com/profile/wow/character/${realm}/${name}?namespace=profile-${server}&locale=en_US`;
        try {
            const data = await this.fetchBlizzard(URI);
            return data
        } catch (error) {
            console.log(error)
        }

    },
    getMedia : async function (data, path) {
        if (data?.code === 404 ) return null;
        let data1;
        try {

            try {
                data1 = await this.fetchBlizzard(data[path].key.href);
            } catch (error) {
                await delay(500);
                try {
                    data1 = await this.fetchBlizzard(data[path].key.href);
                } catch (error) {
                    await delay(200);
                    data1 = await this.fetchBlizzard(data[path].key.href);
                }
            }
            try {
                const data2 = await this.fetchBlizzard(data1.media.key.href);
                return data2 ? data2.assets[0].value : undefined
                
            } catch (error) {
                if (data1?.code === 404 ) return null;
                return data1.assets[0].value
            }
            
        } catch (error) {
            console.log(`getMedia crashing!\nThe data1 is: ${data1}\nThe ERROR message is: ${error}`);
            return undefined
        }

    },
    getRating: async function(path, currentSeasonIndex, server = undefined, realm = undefined, name = undefined) {
        try {
            const bracketsCheatSheet = {
                "SHUFFLE": `solo`,
                "BLITZ": "solo_bg",
                "ARENA_2v2": "2v2",
                "ARENA_3v3": "3v3",
                "BATTLEGROUNDS": "rbg",
              }
            let result = {};
            if (server != undefined && realm != undefined && name != undefined) {

                name = name.toLowerCase();
                path = `https://${server}.api.blizzard.com/profile/wow/character/${realm}/${name}/pvp-summary?namespace=profile-${server}`;

                currentSeasonIndex = await this.getCurrentPvPSeasonIndex();  
            }
            let brackets = (await this.fetchBlizzard(path)).brackets;
            if (brackets == undefined) return {
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
            const bracketFetches = brackets.map(bracket =>this.fetchBlizzard(bracket.href));

            const allBracketsData = await Promise.all(bracketFetches);


            const processBrackets = allBracketsData.map(async (data, index) => {
                const seasonIndex = data.season.id;

                if(seasonIndex != currentSeasonIndex) return null;
                const match = brackets[index].href.match(/pvp-bracket\/([^?]+)/);
                const bracketName = match[1];
                // const pastSeasonCheckURL = `https://${server}.api.blizzard.com/data/wow/pvp-season/${seasonID - 1}/pvp-leaderboard/${bracketName}?namespace=dynamic-${server}&locale=en_US`;
    
                const currentBracket = data.bracket.type;
                // const lastSeasonLadderPromise = helpFetch.getpastRate(pastSeasonCheckURL, name, headers);
                const titlePromise = helpFetch.getPvPTitle(data.tier.key.href);
    
                // const [lastSeasonLadder, title] = await Promise.all([lastSeasonLadderPromise, titlePromise]);
                const title = await titlePromise;
    
                const curentBracketData = {
                    rating: data?.rating,
                    title: title,
                    seasonMatchStatistics: data.season_match_statistics,
                    weeklyMatchStatistics: data.weekly_match_statistics
                };
                const bracketKey = bracketsCheatSheet[currentBracket];
                if (!bracketKey) {
                    console.warn(`Unknown bracket: ${currentBracket}`);
                    return;
                }
    
                if (currentBracket === "BLITZ" || currentBracket === "SHUFFLE") {
                    result[bracketName] = {
                        currentSeason: curentBracketData,
                        // lastSeasonLadder: lastSeasonLadder,
                        record: undefined,
                        _id: `${Math.random()}${bracketKey}${Math.random()}`
                    };
                } else {
                    result[bracketKey] = {
                        currentSeason: curentBracketData,
                        // lastSeasonLadder: lastSeasonLadder,
                        record: undefined,
                        _id: `${Math.random()}${bracketKey}`
                    };
                }
            });
            await Promise.all(processBrackets);
            // if(name == "Lychezar" || name == `lychezar`) debugger;

            return result;
        } catch (error) {
            console.log(error)
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
    getPvPTitle: async function (href) {
        let data = await this.fetchBlizzard(href);
        try {
            if (data?.code == 404 ) return undefined;
            let result = {
                name: data.name.en_GB,
                media: await helpFetch.getMedia(data, `media`)
            }
            return result
        } catch (error) {
            if (data.startsWith("Downstream Error")) {
                try {
                    await delay(2000);
                    const retry = await this.getPvPTitle(href);
                    if(retry) return retry
                } catch (error) {
                    console.warn(error)
                }
            }
            return undefined
        }
    },
    getpastRate: async function (url, playerName) {
        let data;
        try {
            data = await this.fetchBlizzard(url);
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
    getAchievById : async function (href, statId) {
        let data
        try {
            data = await this.fetchBlizzard(href);
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
    getAchievXP: async function (href, points) {
        let data;
        try {
            data = await helpFetch.fetchBlizzard(href);

            const achievementsMAP = new Map();
            const seasonalAchieves = [];
            let cachedMap = await getSeasonalIdsMap();

            if(cachedMap === null) {
                await setSeasonalIdsMap()
                await delay(2000);
                cachedMap = await getSeasonalIdsMap();
            }

            for (const element of data.achievements) {
                achievementsMAP.set(element.id, element)
                const stringID = String(element.id)
                let exist = cachedMap.get(stringID)
                if(exist) {
                    // exist = JSON.parse(exist);
                    const id = Number(exist._id)
                    seasonalAchieves.push(id);
                }
            }
            const result = [await filterAchiev(achievementsMAP, points), seasonalAchieves];
            return result
        } catch (error) {
            console.log(data)
            console.warn(error)
            const result = [await filterAchiev(undefined, undefined, undefined)];
            return result
        }
    },
    fetchBlizzard: async function (url, options = {}) {
        if (typeof url !== "string") {
            throw new TypeError("URL must be a string");
        }

        if (typeof options !== "object" || options === null) {
            throw new TypeError("Options must be a non-null object");
        }

        const apiUrl = url + "&locale=en_GB"

        const accessToken = await getAccessToken();

        const finalOptions = {
            ...options,
            headers: {
                ...(options.headers || {}),
                Authorization: `Bearer ${accessToken}`,
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            }
        };
        let res;
        let text = "D";
        let data = null
        let retries = 0;

        while(data === null && retries < 5) { // Loop for a valid JSON

            try {
                res = await fetch(apiUrl, finalOptions);
                text = await res.text();
                if(!text.startsWith("D")) {
                    data = JSON.parse(text);
                }
            } catch (error) {

                try {
                    
                    const newError = new BlizAPIError({
                        url :url,
                        status: res.status || 0,
                        body : JSON.stringify(res?.body)  || text
                    })
                    await newError.save();

                } catch (err) {
                    console.warn(err)
                }

                await delay(1000); // Delay to give the API air;
                retries += 1
            }
        }

        return data;
    },

    getCharMedia: async function (href) {
        try {
            const data = (await helpFetch.fetchBlizzard(href)).assets;
            const assets = {
                avatar: (data[0])[`value`] || "",
                banner: (data[1])[`value`] || "",
                charImg: (data[2])[`value`] || "",
            }
            return assets
        } catch (error) {
            console.log(error)
            return {}
        }
    },
    getCharGear: async function (href) {
        try {
            const data = await this.fetchBlizzard(href);
            const result = await formatGearData(data);
            return result
        } catch (error) {
            return undefined
        }
    },
    getStats: async function(href){
        try {
            const data = await this.fetchBlizzard(href);
            const result = extractStats(data);
            return result
        } catch (error) {
            console.log(error);
            return undefined
        }
    },
    getCurrentPvPSeasonIndex: async function () {
        const url = "https://eu.api.blizzard.com/data/wow/pvp-season/index?namespace=dynamic-eu&locale=en_GB";

        
        try {
            const data = await this.fetchBlizzard(url);
            const currentSeasonId = data?.current_season?.id;

            return currentSeasonId;
            
        } catch (error) {
            return null
        }
        
    },
    getGuildMembers : async function () {
        const guildNameSlug = "pvp-scalpel";
        const guildRealmSlug = "chamber-of-aspects";
        const guildServer = "eu"
        const path = `https://${guildServer}.api.blizzard.com/data/wow/guild/${guildRealmSlug}/${guildNameSlug}/roster?namespace=profile-${guildServer}`;
       
        const data = await this.fetchBlizzard(path);

        const memberList = data.members;

        return memberList
    },
    getActiveTalentsCode: async function (href) {

        const result = {};
        try {
            const data = await this.fetchBlizzard(href);

            const activeSpecTalent = data?.active_hero_talent_tree?.name;
            const specId = data.active_specialization.id;
            const activeSpecData = data.specializations.find(specDetails => specDetails.specialization.id == specId);
            const activeLoadout = activeSpecData.loadouts.find(loadout => loadout.is_active == true);

            result.talentsCode = activeLoadout ? activeLoadout.talent_loadout_code : null;
            result.talentsSpec = activeSpecTalent ? activeSpecTalent : null;

            return result

        } catch (error) {
            if (Object.keys(result).length === 0) return result
            console.warn(error);
            console.info(result)
            if(!result.talentsCode) result.talentsCode = null;
            if(!result.talentsSpec) result.talentsSpec = null;
            return result
            
        }
    },
    getTalentSpec: async function (href) {
        try {
            const data = await this.fetchBlizzard(href);
            const talentString = data?.active_hero_talent_tree?.name;
            return talentString ? talentString : null;
        } catch (error) {
            console.warn(error);
        }
        return null;
    },
    getRealms: async function (server) {
        if (typeof server !== "string" || server.length !== 2) {
            throw new TypeError("The Server has to be a string of 2 characters");
        }

        const url = `https://${server}.api.blizzard.com/data/wow/search/connected-realm?namespace=dynamic-${server}&orderby=id`;

        try {
            const data = await this.fetchBlizzard(url);
            return data?.results
        } catch (error) {
            return null
        }
    },
    /**
     * Fetches a spell by id from the Blizzard API and returns a normalized object.
     * @param {string|number} id - Spell id.
     * @returns {Promise<{id:number,name:string,description?:string,media?:string}|null|undefined>}
     * Null when not found or missing required fields; undefined on unexpected errors.
     */
    getSpellById: async function (id) {
        if (typeof id !== "string" && typeof id !== "number") {
            throw new TypeError("The id have to be type of string or number");
        }

        const spellUrl = `https://eu.api.blizzard.com/data/wow/spell/${id}?namespace=static-us`;

        try {
            const req = await this.fetchBlizzard(spellUrl);

            if (req.code === 404 || !req.media || !req.name) return null;

            const { id, name, description } = req;

            const media = await this.getMedia(req, "media");

            return {
                id,
                name,
                description,
                media
            }
        } catch (error) {
            console.warn("Error ar getSpellById:");
            console.error(error);
        }
    }
}


async function filterAchiev (achievements, points) {
    // const start = performance.now();
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
                const data = await helpFetch.fetchBlizzard(match.achievement.key.href);
                const twosResult = {
                    name: data.name,
                    description: data.description,
                    media: await helpFetch.getMedia(data, "media")
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
                const data = await helpFetch.fetchBlizzard(match.achievement.key.href);
                const threesResult = {
                    name: data.name,
                    description: data.description,
                    media: await helpFetch.getMedia(data, "media")
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
            const data = await helpFetch.fetchBlizzard(match.achievement.key.href);
            const soloResult = {
                name: data.name,
                description: data.description,
                media: await helpFetch.getMedia(data, "media")
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
            const data = await helpFetch.fetchBlizzard(match.achievement.key.href);
            const BGXPResult = {
                name: data.name,
                description: data.description,
                media: await helpFetch.getMedia(data, "media")
            }
            result["RBG"].XP = BGXPResult;
            result["Blitz"].XP = BGXPResult;
            break;
        } catch (error) {
            (error); break;
        }
    }
    // Get the RBG WINS
    for (const {key, name, id: dataID} of achievesData["RBGWins"]) {
        let match = achievements.get(dataID);
        if (match && match?.completed_timestamp) try {
            const data = await helpFetch.fetchBlizzard(match.achievement.key.href);
            const RBGWinsResult = {
                name: data.name,
                description: data.description,
                media: await helpFetch.getMedia(data, "media")
            }
            result["RBG"].WINS = RBGWinsResult;
            break;
        } catch (error) {
            console.log(error); break;
        }
    }

    let strategistChecker = undefined;
    try {
        strategistChecker = await Achievement.find( { name: { $regex: "strategist", $options: "i" } });
    } catch (error) {
        console.log(error);
        console.log(strategistChecker)
    }

    if (strategistChecker) {
        for (const {  key, name, id: dataID, description, media  } of strategistChecker) {
            let match = achievements.get(dataID);

            if(match && match?.completed_timestamp) {
                const BlitzWinsResult = {
                    name: name,
                    description: description,
                    media: media
                }
                result["Blitz"].WINS = BlitzWinsResult;
                return result // Return to bypass the next check
            }
        }
    }
    // Get the Blitz WINS
    for (const {key, name, id: dataID} of achievesData["BlitzWins"]) {
        let match = achievements.get(dataID);
        if (match && match?.completed_timestamp)
            try {
                const data = await helpFetch.fetchBlizzard(match.achievement.key.href);
                const BlitzWinsResult = {
                    name: data.name,
                    description: data.description,
                    media: await helpFetch.getMedia(data, "media")
                }
                result["Blitz"].WINS = BlitzWinsResult;
                break;
            } catch (error) {
                console.log(error); break;
            }
    }
    // const end = performance.now();
    // console.log(`filterAchiev() took ${(end - start).toFixed(2)} ms`);

    return result
}

async function formatGearData(apiResponse) {
    const gear = {};
    // console.log(apiResponse.equipped_items)

    for (const item of apiResponse.equipped_items) {
        try {
            
            let slot = item.slot.type.toLowerCase();
    
            // Handle mismatches in slot names between API and schema
            const slotMap = {
                "back": "back",
                "main_hand": "wep",
                "off_hand": "offHand",
                "finger_1": "ring1",
                "finger_2": "ring2",
                "trinket_1": "trinket1",
                "trinket_2": "trinket2",
            };
            slot = slotMap[slot] || slot;
    
            const media = await helpFetch.getMedia(item, "media");

            let sockets = [];

            try {
                sockets = item.sockets
                    ? await Promise.all(
                        item.sockets.map(async (socket) => {
                            if (!socket?.item) {
                                return undefined;
                            }

                            return {
                                gemName: socket.item.name,
                                gemId: socket.item.id,
                                media: await helpFetch.getMedia(socket, "media"),
                                bonus: socket.display_string,
                            };
                        })
                    )
                    : [];
            } catch (error) {
                
            }
    
    
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
                    name: enchant?.source_item?.name,
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
            if (item.spells) {
                gear[slot].spells = item.spells
            }
        } catch (error) {
            console.warn(error)
        }



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
