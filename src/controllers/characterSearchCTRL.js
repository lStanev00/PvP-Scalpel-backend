import { Router } from "express";
import Char from "../Models/Chars.js"; // Model
// Helpers
import { jsonMessage, jsonResponse } from "../helpers/resposeHelpers.js";
import helpFetch from "../helpers/blizFetch-helpers/endpointFetchesBliz.js";
import queryCharacterBySearch from "./route_logic/charSearchCtrl/querryCharacter.js";
// import buildCharacter from "../helpers/buildCharacter.js";
import {  getCharacter } from "../caching/characters/charCache.js";

export const characterSearchCTRL = Router();

characterSearchCTRL.get("/searchCharacter", searchCharacterGET)
characterSearchCTRL.get(`/checkCharacter/:server/:realm/:name`, checkCharacterGet);
characterSearchCTRL.patch(`/patchCharacter/:server/:realm/:name`, updateCharacterPatch);
characterSearchCTRL.patch(`/patchPvPData/:server/:realm/:name`, patchPvPData);

async function searchCharacterGET(req, res) {
    const search = req?.query?.search;
    if(!search) jsonMessage(res, 400, `Input of type: ${typeof search}'s not a valied search param. Search you provided is ${search}`);
    try {
        const searchData = await queryCharacterBySearch(search);
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.set('Surrogate-Control', 'no-store');
        return jsonResponse(res, 200, searchData);
        
    } catch (error) {
        console.warn(error);
        return jsonResponse(res, 500);
    }
}

//
async function checkCharacterGet(req, res) {
    const { server, realm, name } = req.params;
    const response= {
        code: 0,
        character: null,
    }
    try {
        const character = await getCharacter(server, realm, name);

        if (character === 404) response.code = 404
            else if (character) response.code = 200
            else if (!character || character === null) response.code = 404;


        response.character = character;
    } catch (error) {
        console.warn(`Error at route: checkCharacterGet`);
        console.error(error);
        response.code = 500;
    }
    
    return jsonResponse(res, response.code, response.character);
}
//

async function updateCharacterPatch(req, res) {
    const { server, realm, name } = req.params;
    let character;
    try {
        character = await getCharacter(server, realm, name, false, true, true);
        if (character) {
            return jsonResponse(res, 200, character);
        } else if (character === 404) {
            return  jsonResponse(res, 404, "Character with this Credentials was not found.")
        } else {
            console.warn(character);
        }
    } catch (error) {
        res.status(500).json({
            messege: "The server encountered an unexpected condition that prevented it from fulfilling the request."
        })
        console.warn(error);
    } finally {
    }

}

async function patchPvPData(req, res) {
    const { server, realm, name } = req.params;
    
    try {
        const char = await Char.findOne({
            name: new RegExp(`^${name}$`, 'i'),
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

            const newChar = await getCharacter(server, realm, name);

            return jsonResponse(res, 201, newChar)

        }
    } catch (error) {
        console.warn(error)
        return jsonMessage(res, 500, "Internal server ERROR")
    }
}