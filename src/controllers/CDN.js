import "dotenv/config";
import { Router } from "express";
import { jsonResponse } from "../helpers/resposeHelpers.js";
import formManifest from "./route_logic/CDN/getManifest.js";
import newManifest from "./route_logic/CDN/postManifest.js";

const AUTH = process.env.JWT_CDN_PUBLIC;

if (!AUTH) {
    throw new Error("JWT_CDN_PUBLIC env variable is missing");
}

const CDNCTRL = Router();

CDNCTRL.get("/CDN/getManifest", getManifest);
CDNCTRL.post("/CDN/postManifest", postManifest);

/**
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function getManifest(_, res) {
    const data = await formManifest();

    if (data === null) {
        return jsonResponse(res, 500, { error: "Failed to build manifest" });
    }

    return jsonResponse(res, 200, data);
}

/**
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function postManifest(req, res) {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader) {
            return jsonResponse(res, 401, { error: "Missing Authorization header" });
        }

        const parts = authHeader.split(" ");

        if (parts.length !== 2) {
            return jsonResponse(res, 401, { error: "Malformed Authorization header" });
        }

        const [type, token] = parts;

        if (type !== "Bearer" || token !== AUTH) {
            return jsonResponse(res, 403, { error: "Invalid token" });
        }

        const ok = await newManifest(req.body);

        if (!ok) return jsonResponse(res, 400, { error: "Invalid manifest payload" });

        return jsonResponse(res, 201, { success: true });
    } catch (error) {
        return jsonResponse(res, 500);
    }
}

export default CDNCTRL;
