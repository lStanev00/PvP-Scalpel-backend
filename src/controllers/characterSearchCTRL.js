import { Router } from "express";
import Char from "../Models/Chars.js"; // Model
// Helpers
import oldDataChecker from "../helpers/controllerHelpers/characterSearchCTRL/hourChecker.js";
import fetchData from "../helpers/blizFetch.js";

const characterSearchCTRL = Router();

characterSearchCTRL.get(`/checkCharacter/:server/:realm/:name`, chechCharacterGet);

const updatingIDs = {};
async function chechCharacterGet(req, res) {
    try {
        const { server, realm, name } = req.params;
    
        const character = await Char.findOne({
            name: name,
            "playerRealm.slug": realm,
            server: server
        }).lean();
    
        if (!character) { // If no mongo entry try updating the db with a new one and send it
            const newCharacter = new Char(await fetchData(server, realm, name));
            res.status(200).json(newCharacter);
            return await newCharacter.save();
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
        return res.status(404).json({messege: `Not Found`})
    }
}


export default characterSearchCTRL