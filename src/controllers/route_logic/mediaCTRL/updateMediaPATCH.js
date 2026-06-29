import { jsonMessage, jsonResponse } from "../../../helpers/resposeHelpers.js";
import MediaMeta from "../../../Models/MediaMeta.js";

/**
 * @typedef {Object} UpdateMediaBody
 * @property {string} _id
 * @property {string} [title]
 * @property {string} [description]
 * @property {import("mongoose").Types.ObjectId[]} [characters]
 * @property {string} [thumbnail]
 * @property {boolean} [isPrivate]
 * @property {number} [bracket]
 */

/**
 * @typedef {Object} AuthenticatedUser
 * @property {import("mongoose").Types.ObjectId} _id
 */

/**
 * @typedef {import("express").Request<
 *     Record<string, never>,
 *     unknown,
 *     UpdateMediaBody
 * > & { user?: AuthenticatedUser }} UpdateMediaRequest
 */

/**
 * Updates editable metadata for an existing media document owned by the
 * authenticated user.
 *
 * @param {UpdateMediaRequest} req
 * @param {import("express").Response} res
 * @returns {Promise<void>}
 */
export default async function updateMediaPATCH(req, res) {
    const {user} = req;
    const {_id, title, description, characters, thumbnail, isPrivate, bracket} = req.body;

    if(!user) return jsonMessage(res, 403, "no Auth");

    try {
        const mediaDoc = await MediaMeta.findById(_id);
        if(!mediaDoc) return jsonMessage(res, 404, "The media with this id does not exist");
        console.info(mediaDoc.author)
        console.info(user.user._id)
        console.info(user)
        if(mediaDoc.author !== user._id) return jsonResponse(res, 403);

        if(title) mediaDoc.title = title;
        if(description) mediaDoc.description = description;
        if(characters) mediaDoc.characters = characters;
        if(thumbnail) mediaDoc.manifest.thumbnail = thumbnail;
        if(isPrivate) mediaDoc.isPrivate = isPrivate;
        if(bracket) mediaDoc.bracket = bracket;

        await mediaDoc.save();

        return jsonResponse(res, 200, mediaDoc.toObject());

    } catch (error) {
        console.warn(`error at updateMediaPATCH`);
        console.error(error);
        return jsonResponse(res, 500);
    }
}
