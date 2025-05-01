import { Router } from "express";
import Char from "../Models/Chars.js";
import { jsonResponse } from "../helpers/resposeHelpers.js";

const LDBControllerTest = Router();

LDBControllerTest.get(`/LDBtest/2v2`, twosGet);
LDBControllerTest.get(`/LDBtest/3v3`, threesGet);
LDBControllerTest.get(`/LDBtest/solo`, soloGet);
LDBControllerTest.get(`/LDBtest/blitz`, blitzGet);
LDBControllerTest.get(`/LDBtest/BG`, BGGet);


async function twosGet(req, res) {
    try {
        const charList = await findRatingAndSort("2v2");

        return jsonResponse(res, 200, charList)
    } catch (error) {
        res.status(500).json({ error: "Internal Server Error", details: error.message });
    }
}


async function threesGet(req,res) {
    try {
        const charList = await findRatingAndSort("3v3");
        
    return jsonResponse(res, 200, charList)        
    } catch (error) {
        return res.status(404);
    }
}

async function soloGet(req,res) {
    try {

        const charList = await findRatingAndSort(`shuffle`);

        return jsonResponse(res, 200, charList)
        
    } catch (error) {
        res.status(404);
    }
}
async function blitzGet(req,res) {
    try {
        const charList = await findRatingAndSort(`blitz`);

        return jsonResponse( res, 200, charList );
        
    } catch (error) {
        res.status(404);
    }
}
async function BGGet(req,res) {
    try {
        const charList = await findRatingAndSort(`rbg`);

        jsonResponse(res, 200, charList)
        
    } catch (error) {
        res.status(404);
    }
}

export default LDBControllerTest


function sortBlitz(players) {
    players = players.sort((a, b) => {
        // 1. Primary Criteria: solo_bg rating
        const ratingA = b.rating?.["solo_bg"] || 0;
        const ratingB = a.rating?.["solo_bg"] || 0;
    
        if (ratingA !== ratingB) {
            return ratingA - ratingB; // Higher solo_bg rating comes first
        }
    
        // 2. Secondary Criteria: Achievements
        const getPriority = (char) => {
            // Check for Hero of the Alliance/Horde
            const heroAchieve = char.achieves?.["BG"]?.find(({ name }) =>
                ["Hero of the Alliance", "Hero of the Horde"].includes(name)
            );
    
            if (heroAchieve) return Infinity; // Hero achievements have the highest priority
    
            // Check for "Earn a rating of X in Rated BG/Blitz"
            const ratingAchieve = char.achieves?.["BG"]?.find(({ description }) =>
                description.includes("Earn a rating of")
            );
    
            if (ratingAchieve) {
                const ratingMatch = ratingAchieve.description.match(/Earn a rating of (\d+)/);
                return ratingMatch ? parseInt(ratingMatch[1], 10) : 0; // Extract and return the numeric rating
            }
    
            return 0; // Default priority if no matching achievements
        };
    
        const priorityA = getPriority(a);
        const priorityB = getPriority(b);
    
        if (priorityA !== priorityB) {
            return priorityB - priorityA; // Higher priority (rating or Hero) comes first
        }
    
        return 0; // If everything is equal, maintain original order
    });

    return players
}

// Helper for the fetches and sort

async function findRatingAndSort (bracket) {

    if (bracket == "shuffle" || bracket == "blitz") {
        try {
            const charList = await Char.find({ guildMember:true })
            .select(`name playerRealm race class activeSpec rating achieves media server`)
            .lean();
            const shuffleEntries = charList.filter(entry => {
                const ratingList = Object.entries(entry?.rating);
                let result = []
                for (const format of ratingList) {
                    const [ bracketName, bracketData ] = format;
                    if (bracketName.startsWith(`${bracket}-`)) result.push(format);
                }

                if (result.length === 0) return false;

                else if (result. length > 1) {
                    result.sort( (a, b) => {
                        const ratingA = a[1]?.currentSeason?.rating || 0;
                        const ratingB = b[1]?.currentSeason?.rating || 0;

                        return ratingB - ratingA;
                    });
                }

                entry.rating = {
                    [result[0][0]] : result[0][1]
                }
                return entry
            });

            return shuffleEntries
            
        } catch (error) {
            console.warn(error);
            return null
        }
    }

    try {
        const charList = await Char.find({
            [`rating.${bracket}.currentSeason.rating`] : { $exists: true },
            guildMember: true
        })
        .select(`name playerRealm race class activeSpec rating achieves.${bracket == "shuffle" ? "solo" : "Blitz"} media server`)
        .sort({
            [`rating.${bracket}.currentSeason.rating`]: -1,
            [`rating.${bracket}.record`]: -1
        })
        .lean();
        return charList
    } catch (error) {
        console.warn(error);
        return null
    }
}