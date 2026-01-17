import { Router } from "express";
import { jsonResponse } from "../helpers/resposeHelpers.js";
import { getManifest } from "../caching/CDNCache/manifestCache.js";
import { getDownloadUrl } from "../caching/CDNCache/downloadAppCache.js";

const CDNCTRL = Router();

CDNCTRL.get("/CDN/manifest", manifestGET);
CDNCTRL.get("/CDN/download/:key", downloadGET);

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

/**
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function downloadGET(req, res) {
    const { key } = req.params;
    if (!key) {
        return jsonResponse(res, 400, { error: "Missing download key" });
    }

    const data = await getDownloadUrl(key);

    if (data === null) {
        return jsonResponse(res, 404, { error: "Download not found" });
    }

    return jsonResponse(res, 200, data?.url ?? null);
}

export default CDNCTRL;
