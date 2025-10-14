import { Router } from "express";
import { getTop10ForABracket, getFullWeekly } from "../caching/weeklyChamps/weeklyChampsCache.js";
import { jsonResponse } from "../helpers/resposeHelpers.js";

const weeklyLadderCTRL = Router();

weeklyLadderCTRL.get("/weekly", getAllWeekly);
weeklyLadderCTRL.get("/weekly/:bracket", getWeekly);

async function getWeekly(req, res) {

    try {
        
        const { bracket } = req.params;
        const data = await getTop10ForABracket(bracket);
        if (!data || data === 404) return jsonResponse(res, 404, "Check the bracket param");
    
        // res.set("Cache-Control", "public, max-age=1000");
        return jsonResponse(res, 200, data);
    } catch (error) {
        console.error(error);
        jsonResponse(res, 500), "Unexpected error has occured. Please report it.";
    }

}

async function getAllWeekly(req, res) {
    try {
        const data = await getFullWeekly();
        if(data === 404) return jsonResponse(res, 404, "Fail to retrive data");

        // res.set("Cache-Control", "public, max-age=1000");
        return jsonResponse(res, 200, data);
    } catch (error) {
        console.error(error);
        jsonResponse(res, 500), "Unexpected error has occured. Please report it.";
    }
}

export default weeklyLadderCTRL;