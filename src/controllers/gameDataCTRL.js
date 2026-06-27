import { Router } from "express";
import { jsonMessage, jsonResponse } from "../helpers/resposeHelpers.js";
import GameClass from "../Models/GameClass.js";
import GameSpecialization from "../Models/GameSpecialization.js";
import retrieveValidSpells from "./route_logic/gameDataCTRL/retrieveValidSpells.js";
import { getGameBrackets } from "../caching/gameBrackets/gameBracketsCache.js";

const gameDataCTRL = Router();

const TWO_DAYS_SECONDS = 60 * 60 * 24 * 2;

gameDataCTRL.get("/game/classes", getGameClasses);
gameDataCTRL.get("/game/specs", getGameSpecs);
gameDataCTRL.get("/game/brackets", getBrackets);
gameDataCTRL.post("/game/spells", getGameSpellsByIds);

function setTwoDayCache(res) {
    res.set("Cache-Control", `public, max-age=${TWO_DAYS_SECONDS}, s-maxage=${TWO_DAYS_SECONDS}`);
}

async function getGameClasses(_, res) {
    try {
        const data = await GameClass.find().populate("specs").lean();
        setTwoDayCache(res);
        return jsonResponse(res, 200, data);
    } catch (error) {
        console.warn(error);
        return jsonMessage(res, 500, "Internal server error");
    }
}

async function getGameSpecs(_, res) {
    try {
        const data = await GameSpecialization.find().lean();
        setTwoDayCache(res);
        return jsonResponse(res, 200, data);
    } catch (error) {
        console.warn(error);
        return jsonMessage(res, 500, "Internal server error");
    }
}

async function getGameSpellsByIds(req, res) {
    const spellArray = Array.isArray(req.body) ? req.body : req.body?.ids;
    try {
        const data = await retrieveValidSpells(spellArray);
        return jsonResponse(res, 200, data);
    } catch (error) {
        console.warn(error);
        return jsonMessage(res, 500, "Internal server error");
    }
}

async function getBrackets(_, res) {
    try {
        const brackets = await getGameBrackets();
        if(brackets){
            setTwoDayCache(res);
            return jsonResponse(res, 200, brackets);
        } 
    } catch (error) {
        console.error(error);
        return jsonResponse(res, 500);
    }
}

export default gameDataCTRL;
