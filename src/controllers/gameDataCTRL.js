import { Router } from "express";
import { jsonMessage, jsonResponse } from "../helpers/resposeHelpers.js";
import GameClass from "../Models/GameClass.js";
import GameSpecialization from "../Models/GameSpecialization.js";

const gameDataCTRL = Router();

const TEN_DAYS_SECONDS = 60 * 60 * 24 * 10;

gameDataCTRL.get("/game/classes", getGameClasses);
gameDataCTRL.get("/game/specs", getGameSpecs);
gameDataCTRL.post("/game/spells", getGameSpellsByIds);

function setTenDayCache(res) {
    res.set("Cache-Control", `public, max-age=${TEN_DAYS_SECONDS}, s-maxage=${TEN_DAYS_SECONDS}`);
}

async function getGameClasses(_, res) {
    try {
        const data = await GameClass.find().lean();
        setTenDayCache(res);
        return jsonResponse(res, 200, data);
    } catch (error) {
        console.warn(error);
        return jsonMessage(res, 500, "Internal server error");
    }
}

async function getGameSpecs(_, res) {
    try {
        const data = await GameSpecialization.find().lean();
        setTenDayCache(res);
        return jsonResponse(res, 200, data);
    } catch (error) {
        console.warn(error);
        return jsonMessage(res, 500, "Internal server error");
    }
}

async function getGameSpellsByIds(req, res) {
    const ids = Array.isArray(req.body) ? req.body : req.body?.ids;
    try {
        return jsonResponse(res, 200, data);
    } catch (error) {
        console.warn(error);
        return jsonMessage(res, 500, "Internal server error");
    }
}

export default gameDataCTRL;
