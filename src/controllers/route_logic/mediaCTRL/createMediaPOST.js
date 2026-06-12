import { initMediaForm } from "../../../caching/mediaCache/mediaCache.js";
import { jsonMessage, jsonResponse } from "../../../helpers/resposeHelpers.js";
import MediaMeta from "../../../Models/MediaMeta.js";

/**
 * @typedef {Object} MediaManifestInput
 * @property {string[]} [meidaParts]
 * @property {string | null} [thumbnail]
 */

/**
 * @typedef {Object} CreateMediaBody
 * @property {"video"} type
 * @property {boolean} [isPrivate]
 * @property {string} title
 * @property {string} [description]
 * @property {string[]} [characters]
 * @property {number} [bracket]
 * @property {MediaManifestInput} manifest
 * @property {unknown[]} fileData
 */

/**
 * @typedef {Object} AuthenticatedUser
 * @property {import("mongoose").Types.ObjectId} _id
 * @property {string} role
 */

/**
 * @typedef {import("express").Request<
 *     Record<string, never>,
 *     unknown,
 *     CreateMediaBody
 * > & { user: AuthenticatedUser }} CreateMediaRequest
 */

/**
 * @param {CreateMediaRequest} req
 * @param {import("express").Response} res
 */
export async function createMediaPOST(req, res) {
    const {
        type,
        isPrivate,
        title,
        description,
        characters,
        bracket,
        manifest,
        fileData,
    } = req.body ?? {};

    try {
        if (!fileData) {
            return jsonMessage(
                res,
                400,
                "There's not provided data for the file key should be `fileData`",
            );
        } else if (!Array.isArray(fileData) || fileData.length === 0) jsonMessage(res, 500, "1");

        const media = await MediaMeta.create({
            type,
            state: "initializing",
            isPrivate,
            title,
            description,
            author: req.user._id,
            characters : characters ? characters : [],
            bracket,
            manifest,
        });

        await initMediaForm(media);
        
        return jsonResponse(res, 201, media.toObject());
    } catch (error) {
        if (error?.name === "ValidationError" || error?.name === "CastError") {
            return jsonMessage(res, 400, error.message);
        }

        console.error(error);
        return jsonMessage(res, 500, "Internal server error");
    }
}

export function requireAdmin(req, res, next) {
    if (!req.user) {
        return jsonMessage(res, 401, "Authentication required");
    }

    if (req.user.role !== "admin") {
        return jsonMessage(res, 403, "Non authorized action");
    }

    return next();
}
