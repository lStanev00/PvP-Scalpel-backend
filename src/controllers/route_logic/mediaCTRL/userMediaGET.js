import { jsonResponse } from "../../../helpers/resposeHelpers.js";
import MediaMeta from "../../../Models/MediaMeta.js";

export default async function userMediaGET(req, res) {
    const {user} = req;

    try {
        const userMediaArr = await MediaMeta.find({author: user._id}).lean();
        return jsonResponse(res, 200, userMediaArr)
    } catch (error) {
        console.warn(`err at userMediaGET.js`);
        console.error(error);
        return jsonResponse(res, 500);
    }
}