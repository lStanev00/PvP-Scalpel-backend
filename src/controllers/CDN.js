import "dotenv/config";
import { Router } from "express";
import { jsonResponse } from "../helpers/resposeHelpers.js";

const AUTH = process.env.JWT_CDN_PUBLIC;

const CDNCTRL = Router();

CDNCTRL.get("/CDN/getManifest", getManifest);

async function getManifest(req, res) {
    const authHeader = req.headers.authorization;
    if (!authHeader) return jsonResponse(res, 401, { error: "Missing Authorization header" });

    const [type, token] = authHeader.split(" ");

    if (type !== "Bearer" || token !== AUTH)
        return jsonResponse(res, 403, { error: "Invalid token" });

    return res.json({ message: "Hello CDN" });
}

export default CDNCTRL;
