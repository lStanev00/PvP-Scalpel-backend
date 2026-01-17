import { Router } from "express";
import { jsonResponse } from "../helpers/resposeHelpers.js";
import { getManifest } from "../caching/CDNCache/manifestCache.js";

const CDNCTRL = Router();

CDNCTRL.get("/CDN/manifest", manifestGET);

/**
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function manifestGET(_, res) {
    const data = await getManifest();

    if (data === null) {
        return jsonResponse(res, 500, { error: "Failed to get manifest" });
    }

    return jsonResponse(res, 200, data);
}

export default CDNCTRL;
