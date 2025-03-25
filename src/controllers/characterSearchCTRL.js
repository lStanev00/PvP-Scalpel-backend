import { Router } from "express";
import Char from "../Models/Chars.js"; // Model
// Helpers
import oldDataChecker from "../helpers/controllerHelpers/characterSearchCTRL/hourChecker.js";
import fetchData from "../helpers/blizFetch.js";

const characterSearchCTRL = Router();

characterSearchCTRL.get(`/checkCharacter/:server/:realm/:name`, chechCharacterGet);
characterSearchCTRL.patch(`/patchCharacter/:server/:realm/:name`, updateCharacterPatch);

const patchingIDs = {};
const buildingEntries = {}
async function chechCharacterGet(req, res) {
    try {
        const { server, realm, name } = req.params;
    
        let character = await Char.findOneAndUpdate(
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
            if (buildingEntries[key]) {

                while (buildingEntries[key]) {
                    await new Promise(resolve => setTimeout(resolve, 300)); // little delay

                    
                };
                character = await Char.findOne({
                        name: name,
                        "playerRealm.slug": realm,
                        server: server
                }).lean();
                res.status(200).json(character)
            }
            buildingEntries[key] = true;
            character = await fetchData(server, realm, name);
            character.checkedCount = 1;
            try {
                const newCharacter = new Char(character);
                res.status(200).json(newCharacter);
                await newCharacter.save();
                return delete buildingEntries[key];
                
            } catch (error) {
                return res.status(404).json({
                    messege : `No player in Region: ${server}, in Realm: ${realm}, with Name: ${name}\nCheck your input and try again.`
                })
            }
        }
        
        if (patchingIDs[character.id]) { // If already updating

            while (patchingIDs[character.id]) await new Promise(resolve => setTimeout(resolve, 300)); // little delay
             
            character = await Char.findById(character.id).lean();
        }
        return res.status(200).json(character)
    
    } catch (error) {
        res.status(500).json({messege: `Error retrieveing the data`})
        return console.warn(error)
    }
}

async function updateCharacterPatch(req, res) {
    const { server, realm, name } = req.params;
    let character;

    try {
        character = await Char.findOneAndUpdate(
            {
                name: name,
                "playerRealm.slug": realm,
                server: server
            },
            { $inc: { checkedCount: 1 } }, 
            { new: true, upsert: false, timestamps: false }
        ).lean();
        
    } catch (error) {
        return res.status(404).json({
            messege: `The entry does not exist, try get on:\n/checkCharacter/${server}/${realm}/${name}`,
        });
    }
    const checkedCount = character.checkedCount;
    const charID = character._id;

    try {
        patchingIDs[charID] = true;

        const newCharacterData = await fetchData(server, realm, name);
        newCharacterData.checkedCount = checkedCount;
    
        const patchedData = await Char.findByIdAndUpdate(charID, {
            $set: newCharacterData
          }, {
            new: true
          });
        
        return res.status(200).json(patchedData);

    } catch (error) {
        res.status(500).json({
            messege: "The server encountered an unexpected condition that prevented it from fulfilling the request."
        })
        console.warn(error);
    } finally {
       if (patchingIDs[charID]) delete patchingIDs[charID];
    }

}

export default characterSearchCTRL