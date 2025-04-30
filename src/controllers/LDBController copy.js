import { Router } from "express";
import Char from "../Models/Chars.js";

const LDBControllerTest = Router();

LDBControllerTest.get(`/LDBtest/2v2`, twosGet);
LDBControllerTest.get(`/LDBtest/3v3`, threesGet);
LDBControllerTest.get(`/LDBtest/solo`, soloGet);
LDBControllerTest.get(`/LDBtest/blitz`, blitzGet);
LDBControllerTest.get(`/LDBtest/BG`, BGGet);


async function twosGet(req, res) {
    try {
        const charList = await Char.find({ 
            "rating.2v2.currentSeason.rating" : { $exists : true },
            guildMember: true 
        })
        .sort({
            'rating.2v2.currentSeason.rating': -1,
            'rating.2v2.record': -1
        })
        .lean();

        res.status(200).json(charList);
    } catch (error) {
        res.status(500).json({ error: "Internal Server Error", details: error.message });
    }
}


async function threesGet(req,res) {
    try {
        const charList = await Char.find({
            "rating.3v3.currentSeason.rating" : { $exists: true },
            guildMember: true
        }).sort({
            "rating.3v3.currentSeason.rating": -1,
            "rating.3v3.record": -1
        })
        .lean();
        
        res.status(200).json(charList);
        
    } catch (error) {
        res.status(404);
    }
}

async function soloGet(req,res) {
    try {


        
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


// Helper for the fetches and sort

async function fetchRatingAndSort (bracket) {

    try {
        const charList = await Char.find({
            [`rating.${bracket}.currentSeason.rating`] : { $exists: true },
            guildMember: true
        }).sort({
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