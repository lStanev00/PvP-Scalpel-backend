import { Router } from "express";
import Char from "../Models/Chars.js"; // Model
import mongoose from "mongoose";
// Helpers
import oldDataChecker from "../helpers/controllerHelpers/characterSearchCTRL/hourChecker.js";
import fetchData from "../helpers/blizFetch.js";

const characterSearchCTRL = Router();

characterSearchCTRL.get(`/checkCharacter/:server/:realm/:name`, chechCharacterGet);

const updatingIDs = {};
const buildingEntries = {}
async function chechCharacterGet(req, res) {
    try {
        const { server, realm, name } = req.params;
    
        const character = await Char.findOneAndUpdate(
            {
                name: name,
                "playerRealm.slug": realm,
                server: server
            },
            { $inc: { checkedCount: 1 } }, 
            { new: true, upsert: false, timestamps: false }
        ).lean();

        if (!character) { // If no mongo entry try updating the db with a new one and send it
            const key = `${server + realm + name}`;
            if (buildingEntries[key]) return res.status(503).json({message: "Service temporarily unavailable. Data is still being fetched. Please try again later."})
            buildingEntries[key] = true;
            const newCharacter = new Char(await fetchData(server, realm, name));
            res.status(200).json(newCharacter);
            await newCharacter.save();
            return delete buildingEntries[key];
        }
        
        if (updatingIDs[character.id]) { // If already updating
            character.updating = true;
            return res.status(202).json(character);
        }
        const isDataFresh = await oldDataChecker(character);
    
        if (isDataFresh) return res.status(200).json(character); // If the data is younger than 1 hr retun it with status 200
    
        res.status(202).json(character); // If data is older than 1 hour send the data + status 202 and start updating
    
        const charID = character._id;
        updatingIDs[charID] = true;
    
        const newCharacterData = await fetchData(server, realm, name);
    
        await Char.findByIdAndUpdate(charID, {
            $set: newCharacterData
        });
        delete updatingIDs[charID]
        
    } catch (error) {
        console.log(error)
        return res.status(404).json({messege: `404`})
    }
}


export default characterSearchCTRL