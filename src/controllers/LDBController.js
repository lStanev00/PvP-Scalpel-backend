import { Router } from "express";
import Char from "../Models/Chars.js";
import { jsonResponse } from "../helpers/resposeHelpers.js";

const LDBController = Router();

LDBController.get(`/LDB/2v2`, twosGet);
LDBController.get(`/LDB/3v3`, threesGet);
LDBController.get(`/LDB/solo`, soloGet);
LDBController.get(`/LDB/blitz`, blitzGet);
LDBController.get(`/LDB/BG`, BGGet);


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

export default LDBController

// Helper for the fetches and sort

async function findRatingAndSort (bracket) {

    if (bracket == "shuffle" || bracket == "blitz") {
        try {
            const charList = await Char.find({ guildMember:true })
            .select(`name playerRealm race class activeSpec rating achieves.${bracket == "shuffle" ? "solo" : "Blitz"} media server`)
            .lean();
            const hibrdEntries = charList.filter(entry => {
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

                entry.rating = [
                    [result[0][0]] , result[0][1]
                ]
                
                return entry
            });

            const sortedEntries = hibrdEntries.sort((a, b) => {
                const ratingA = a?.rating[1].currentSeason?.rating || 0;
                const ratingB = b.rating[1].currentSeason?.rating || 0;

                return ratingB - ratingA;
            });

            for (let i = 0; i < sortedEntries.length; i++) {
                
                const element = sortedEntries[i];

                const objRestructure = {
                    [element.rating[0]] : element.rating[1]
                }
                
                sortedEntries[i].rating = objRestructure;

            }

            return sortedEntries
            
        } catch (error) {
            console.warn(error);
            return null
        }
    }

    try {
        let achievName = String;

        if (bracket == "2v2") achievName = "2s"
        else if (bracket == "3v3") achievName = "3s"
        else achievName = "RBG"

        const charList = await Char.find({
            [`rating.${bracket}.currentSeason.rating`] : { $exists: true },
            guildMember: true
        })
        .select(`name playerRealm race class activeSpec rating.${bracket} achieves.${achievName} media server`)
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