import { Router } from "express";
import { getTop10ForABracket } from "../caching/weeklyChamps/weeklyChampsCache.js";
import { jsonResponse } from "../helpers/resposeHelpers.js";

const weeklyLadderCTRL = Router();

weeklyLadderCTRL.get("/weekly/:bracket", getWeekly);

const getWeekly = async (req, res) => {
    const { bracket } = req.params;
    const data = await getTop10ForABracket(bracket);
    if (!data || data === 404) return jsonResponse(res, 404, "Check the bracket param");

    return jsonResponse(res, 200, data);
}

export default weeklyLadderCTRL;