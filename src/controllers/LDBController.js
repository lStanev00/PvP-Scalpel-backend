import { Router } from "express";
import Member from "../Models/Member.js"

const LDBController = Router();

LDBController.get(`/LDB/2v2`, twosGet);
LDBController.get(`/LDB/3v3`, threesGet);
LDBController.get(`/LDB/solo`, soloGet);
LDBController.get(`/LDB/blitz`, blitzGet);
LDBController.get(`/LDB/BG`, BGGet);


async function twosGet(req, res) {
    try {
        const sortObj = {
            "Gladiator": 5,
            "Duelist": 4,
            "Rival": 3,
            "Challenger": 2,
            "Unranked": 1
        };

        // Fetch players from MongoDB
        let players = await Member.find(
            { "rating.2v2": { $exists: true } }, 
            { name: 1, "rating.2v2": 1, "media.avatar": 1, 'playerRealmSlug': 1, 'class' : 1, 'spec': 1, "achieves.2s": 1, _id: 1 }
        );

        // Sort in JavaScript (since MongoDB cannot use a function)
        players = players.sort((a, b) => {
            const ratingA = a.rating?.["2v2"] || 0;
            const ratingB = b.rating?.["2v2"] || 0;

            if (ratingA !== ratingB) {
                return ratingB - ratingA; // Higher rating first
            }

            const achieveA = a.achieves?.["2s"]?.name || "Unranked"; 
            const achieveB = b.achieves?.["2s"]?.name || "Unranked";

            const rankA = sortObj[achieveA] || 1;
            const rankB = sortObj[achieveB] || 1;

            return rankB - rankA; // Higher achievement first
        });

        res.status(200).json(players);
    } catch (error) {
        res.status(500).json({ error: "Internal Server Error", details: error.message });
    }
}


async function threesGet(req,res) {
    try {
        const sortObj = {
            "Three's Company: 2700": 7,
            "Three's Company: 2400": 6,
            "Three's Company: 2200": 5,
            "Three's Company: 2000": 4,
            "Three's Company: 1750": 3,
            "Three's Company: 1550": 2,
            "0": 1
        };
        let players = await Member.find(
            { "rating.3v3": { $exists: true } }, 
            { name: 1, "rating.3v3": 1, 'playerRealmSlug': 1, 'class' : 1, 'spec': 1, "media.avatar": 1, "achieves.3s": 1, _id: 1 } 
          ).sort({ "rating.3v3": -1 }); 

          players = players.sort((a, b) => {
            const ratingA = b.rating?.["3v3"] || 0;
            const ratingB = a.rating?.["3v3"] || 0;
        
            if (ratingA !== ratingB) {
                return ratingA - ratingB; 
            } else {
                const achieveA = a.achieves?.["3s"]?.name || "Unranked"; 
                const achieveB = b.achieves?.["3s"]?.name || "Unranked";
        
                const rankA = sortObj[achieveA] || 1; 
                const rankB = sortObj[achieveB] || 1;
        
                return rankB - rankA; 
            }
        });
        
        res.status(200).json(players);
        
    } catch (error) {
        res.status(404);
    }
}

async function soloGet(req,res) {
    try {
        const players = await Member.find(
            { "rating.solo": { $exists: true } }, 
            { name: 1, "media.avatar": 1, 'playerRealmSlug': 1, 'class' : 1, 'spec': 1, "rating.solo": 1, _id: 1 } 
          ).sort({ "rating.solo": -1 }); 

        res.status(200).json(players);
        
    } catch (error) {
        res.status(404);
    }
}
async function blitzGet(req,res) {
    try {
        let players = await Member.find(
            { "rating.solo_bg": { $exists: true } }, 
            { name: 1, "rating.solo_bg": 1,'playerRealmSlug': 1, "achieves.BG": 1, "media.avatar": 1, 'class' : 1, 'spec': 1, _id: 1 } 
          );
        players = sortBlitz(players);
        res.status(200).json(players);
        
    } catch (error) {
        res.status(404);
    }
}
async function BGGet(req,res) {
    try {
        let players = await Member.find(
            { "rating.rbg": { $exists: true } }, 
            { name: 1, "rating.rbg": 1,  'class' : 1, 'playerRealmSlug': 1, 'spec': 1, "media.avatar": 1,  "achieves.BG": 1, _id: 1 } 
          );
          
        players = sortBG(players);
        res.status(200).json(players);
        
    } catch (error) {
        res.status(404);
    }
}

export default LDBController


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
function sortBG(players) {
    players = players.sort((a, b) => {
        // 1. Primary Criteria: bg rating
        const ratingA = b.rating?.["rbg"] || 0;
        const ratingB = a.rating?.["rbg"] || 0;
    
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