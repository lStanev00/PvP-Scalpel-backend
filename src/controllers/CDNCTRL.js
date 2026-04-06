import { Router } from "express";
import { jsonResponse } from "../helpers/resposeHelpers.js";
import { getManifest } from "../caching/CDNCache/manifestCache.js";
import { getDownloadUrl, storeDownloadUrl } from "../caching/CDNCache/downloadAppCache.js";

const DOWNLOAD_KEYS = ["addon", "desktop", "launcher"];
const FRONTEND_CONTENT_FOLDER = "frontend-content";
const PUBLIC_CDN_BASE_URL = String(
    process.env.CDN_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || "",
)
    .trim()
    .replace(/\/+$/, "");

const CDNCTRL = Router();

CDNCTRL.get("/CDN/manifest", manifestGET);
CDNCTRL.get("/CDN/download/refresh", downloadRefreshGET);
CDNCTRL.get("/CDN/download/:key", downloadGET);
CDNCTRL.get("/CDN/FEContent", FEContentGET);

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

/**
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function downloadRefreshGET(req, res) {
    const keyParam = String(req.query?.key || "").trim();

    if (keyParam) {
        if (!DOWNLOAD_KEYS.includes(keyParam)) {
            return jsonResponse(res, 400, { error: "Invalid download key" });
        }

        const data = await storeDownloadUrl(keyParam);
        if (!data) {
            return jsonResponse(res, 500, {
                error: "Failed to update download cache",
            });
        }

        return jsonResponse(res, 200, { key: keyParam, url: data.url ?? null });
    }

    const results = await Promise.all(
        DOWNLOAD_KEYS.map(async (targetKey) => {
            const data = await storeDownloadUrl(targetKey);
            return {
                key: targetKey,
                ok: Boolean(data),
                url: data?.url ?? null,
            };
        }),
    );

    const failed = results.filter((result) => !result.ok);
    if (failed.length > 0) {
        return jsonResponse(res, 500, {
            error: "Failed to update download cache",
            results,
        });
    }

    return jsonResponse(res, 200, results);
}

/**
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function FEContentGET(req, res) {
    if (!PUBLIC_CDN_BASE_URL) {
        return jsonResponse(res, 500, {
            error: "Missing CDN_PUBLIC_BASE_URL or PUBLIC_BASE_URL",
        });
    }

    const fileName = String(req.query?.path || "").trim();
    if (!fileName) {
        return jsonResponse(res, 400, { error: "Missing path query param" });
    }

    if (fileName.includes("/") || fileName.includes("\\") || fileName.includes("..")) {
        return jsonResponse(res, 400, {
            error: "Path must be a file name only",
        });
    }

    const objectPath = `${FRONTEND_CONTENT_FOLDER}/${fileName}`;
    const url = `${PUBLIC_CDN_BASE_URL}/${objectPath
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/")}`;

    return jsonResponse(res, 200, {
        path: objectPath,
        url,
    });
}

export default CDNCTRL;
