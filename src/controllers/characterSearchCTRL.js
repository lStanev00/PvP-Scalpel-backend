import { Router } from "express";
import Char from "../Models/Chars.js"; // Model
// Helpers
import fetchData from "../helpers/blizFetch.js";
import { jsonMessage, jsonResponse } from "../helpers/resposeHelpers.js";
import helpFetch from "../helpers/blizFetch-helpers/endpointFetchesBliz.js";
import { getCharSearchMap, insertOneCharSearchMap } from "../caching/searchCache/charSearchCache.js";
import { getRealmSearchMap } from "../caching/searchCache/realmSearchCach.js";
import queryCharacterBySearch from "./route_logic/charSearchCtrl/querryCharacter.js";

export const characterSearchCTRL = Router();

characterSearchCTRL.get("/searchCharacter", searchCharacterGET)
characterSearchCTRL.get(`/checkCharacter/:server/:realm/:name`, checkCharacterGet);
characterSearchCTRL.get(`/characterCache`, getCharsMap);
characterSearchCTRL.patch(`/patchCharacter/:server/:realm/:name`, updateCharacterPatch);
characterSearchCTRL.patch(`/patchPvPData/:server/:realm/:name`, patchPvPData);

const patchingIDs = {};
const buildingEntries = {}

async function searchCharacterGET(req, res) {
    const search = req?.query?.search;
    if(!search) jsonMessage(res, 400, `Input of type: ${typeof search}'s not a valied search param. Search you provided is ${search}`);
    try {
        const searchData = queryCharacterBySearch(search);
        return jsonResponse(res, 200, searchData);
        
    } catch (error) {
        console.warn(error);
        return jsonResponse(res, 500);
    }
}


async function checkCharacterGet(req, res) {
    try {
        const { server, realm, name } = req.params;
        let character = await getCharacter(server, realm, name);

        if(!character) {
            character = await buildCharacter(server, realm, name, character, res);
    
            if (!character){ 
                character = await buildCharacter(server, realm, name);
                if(character === null ) return jsonResponse(res, 404)
                jsonResponse(res, 200, character);
                
                 return res.end()


                // return jsonMessage(res, 404, "No character with this credentials");
            }
            character = await getCharacter(server, realm, name);
            return jsonResponse(res, 200, character);
    
    
        }
        
        if (buildingEntries[character.id]) { // If already updating

            while (buildingEntries[character.id]) await new Promise(resolve => setTimeout(resolve, 300)); // little delay
             
            character = await getCharacter(server, realm, name);
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
        )
        
    } catch (error) {
        // return res.status(404).json({
        //     messege: `The entry does not exist, try get on:\n/checkCharacter/${server}/${realm}/${name}`,
        // });
    }

    if(!character) {
        character = await buildCharacter(server, realm, name, character, res);

        if (!character) return jsonMessage(res, 404, "No character with this credentials");

        character = await getCharacter(server, realm, name);

        return jsonResponse(res, 200, character);
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

            await patchedData.populate({
            path: "posts", 
            populate: {
              path: "author",          
              select: "username _id"   
            }
          })

          await patchedData.populate("listAchievements");
        
        return res.status(200).json(patchedData.toObject());

    } catch (error) {
        res.status(500).json({
            messege: "The server encountered an unexpected condition that prevented it from fulfilling the request."
        })
        console.warn(error);
    } finally {
       if (patchingIDs[charID]) delete patchingIDs[charID];
    }

}

async function patchPvPData(req, res) {
    const { server, realm, name } = req.params;
    
    try {
        const char = await Char.findOne({
            name: name,
            "playerRealm.slug" : realm,
            server: server
        })

        
        if (char) {
            
            const PvPData = await helpFetch.getRating(undefined, undefined, undefined, server, realm, name);
            const updatedCharPvpData = await Char.findByIdAndUpdate(char._id, {
                rating: PvPData
            },{ new: true });

            const safeDataToShip = updatedCharPvpData.toObject();
            
            return jsonResponse(res, 200, safeDataToShip);

        } else {

            const newChar = await buildCharacter(server, realm, name);

            return jsonResponse(res, 201, newChar)

        }
    } catch (error) {
        console.warn(error)
        return jsonMessage(res, 500, "Internal server ERROR")
    }
}

async function getRealmsMap(req, res) {
    try {
        
        const realmsSearchMap = getRealmSearchMap();
        if (realmsSearchMap === null) return jsonResponse(res, 404);

            const etag = `"realms-${realmsSearchMap.size}"`;
            if (req.headers['if-none-match'] === etag) return jsonResponse(res, 304);
    
        const plainObj = Object.fromEntries(realmsSearchMap);

        res.set({
            'Cache-Control': 'public, max-age=864000, must-revalidate', // cache for 10 days
            'ETag': etag, // ver controll
        });
        return jsonResponse(res, 200, plainObj)
    } catch (error) {
        return jsonResponse(res, 500, "Internal Server Error");
    }
}
async function getCharsMap(req, res) {
    try {
        
        const realmsSearchMap = getCharSearchMap();
        if (realmsSearchMap === null) return jsonResponse(res, 404);

            const etag = `"realms-${realmsSearchMap.size}"`;
            if (req.headers['if-none-match'] === etag) return jsonResponse(res, 304);
    
        const plainObj = Object.fromEntries(realmsSearchMap);
        res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.set({
            'ETag': etag, // ver controll
        });
        return jsonResponse(res, 200, plainObj)
    } catch (error) {
        return jsonResponse(res, 500, "Internal Server Error");
    }
}


export async function searchCharacter(req, res) {
    
}

export async function buildCharacter(server, realm, name, character) { // If no mongo entry try updating the db with a new one and send it
    const key = `${server + realm + name}`;
    if (buildingEntries[key]) {

        while (buildingEntries[key]) {
            await new Promise(resolve => setTimeout(resolve, 300)); // little delay

            
        };
        character = await Char.findOne({
                name: name,
                "playerRealm.slug": realm,
                server: server
        }).populate({
            path: "posts", 
            populate: {
              path: "author",          
              select: "username _id"   
            }
          }).lean();
        return character
    }
    buildingEntries[key] = true;
    character = await fetchData(server, realm, name);
    if (character == false) {
        console.log("Character missing: ",server,realm,name);
        delete buildingEntries[key];
        return null
    }
    character.checkedCount = 0;
    try {
        const newCharacter = new Char(character);
        const savedChar = await newCharacter.save();
        delete buildingEntries[key];

        insertOneCharSearchMap(savedChar);

        return character;
        
    } catch (error) {
        console.log(error)
        return null;
    }
}

export async function getCharacter(server, realm, name) {

    let character = null;

    try {
        character = await Char.findOneAndUpdate(
            {
                name: name,
                "playerRealm.slug": realm,
                server: server
            },
            { $inc: { checkedCount: 1 } }, 
            { new: true, upsert: false, timestamps: false }
        )
        await character.populate({
            path: "posts", 
            populate: {
              path: "author",          
              select: "username _id"   
            }
        })
        await character.populate("listAchievements");
        character = character.toObject();

        
    } catch (error) {
    }
    return character
}

