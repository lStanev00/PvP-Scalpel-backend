import { uploadPresignLink } from "../../caching/CDNCache/CDN/cdn.config.js";
import { finalizeUploadCache, getMediaCache } from "../../caching/mediaCache/mediaCache.js";
import MediaMeta from "../../Models/MediaMeta.js";
import { wsMessage } from "../helpers/wsResponseHelpers.js";

/**
 * Authenticated user context attached by the WebSocket auth hydration step.
 *
 * @typedef {object} WsAuthenticatedUser
 * @property {import("mongoose").Types.ObjectId} _id
 * @property {string} role
 */

/**
 * Minimal WebSocket shape used by WS handlers.
 *
 * @typedef {object} HandlerWebSocket
 * @property {(payload: string) => unknown} send Send a serialized payload to the client.
 * @property {(code?: number, reason?: string) => unknown} [close] Close the WebSocket connection.
 * @property {(event: "close", listener: () => void) => unknown} [once] Register a one-time event listener.
 * @property {Record<string, unknown>} [JWT] Validated JWT payload, when the client connected with a valid `token` cookie.
 * @property {WsAuthenticatedUser} [user] Authenticated user document, when the client connected with a valid `token` cookie.
 */

/**
 * Message envelope expected by the upload handler.
 *
 * The upload message contract is not implemented yet. Keep this intentionally
 * broad so future upload payload fields can be added without fighting the
 * current placeholder.
 *
 * @typedef {object} UploadMessage
 * @property {string} [type] Message type routed by `src/WS/wsRouter.js`.
 * @property {unknown} [data] Upload payload once the protocol is defined.
 * @property {Record<string, unknown>} [meta] Optional client-provided metadata.
 */

/**
 * Placeholder handler for future WebSocket upload messages.
 *
 * This function is intentionally a no-op until the upload protocol is defined
 * and routed. It is kept async to match the rest of the WS handler interface.
 *
 * @param {HandlerWebSocket} ws Active WebSocket client connection.
 * @param {UploadMessage} msg Parsed JSON message from the client.
 * @returns {Promise<void>}
 */
export default async function uploadHandler(ws, msg) {
    try {
        const user = ws.user;

        if (!user) {
            wsMessage(ws, "auth", "not authenticated");
            ws.close?.(1008, "Authentication required");
            return;
        }

        if (!msg.data || typeof msg.data !== "object") {
            wsMessage(ws, "error", "Upload message requires data");
            return;
        }

        const { type, msgContext } = msg.data;
        if (!msgContext || typeof msgContext !== "object") {
            wsMessage(ws, "error", "Upload message requires msgContext");
            return;
        }

        const { mediaID } = msgContext;
        if (!mediaID) {
            wsMessage(ws, "error", "Upload message requires mediaID");
            return;
        }

        const cachedMedia = await getMediaCache(mediaID);

        if (!cachedMedia) {
            wsMessage(ws, "error", "There's not such media in the cache");
            return;
        }

        const mediaDoc = await MediaMeta.findById(mediaID);
        if (!mediaDoc) {
            wsMessage(ws, "error", "Media document was not found");
            return;
        }

        const mediaAuthor = mediaDoc.author;
        const isOwner = mediaAuthor?.toString() === user._id?.toString();
        const isAdmin = user.role === "admin";

        if (!isOwner && !isAdmin) {
            wsMessage(ws, "error", "Non authorized action");
            return;
        }

        if (type === "uploadFeedback") {
            // manages the bucket metadata routes path

            const { index, route } = msgContext;

            if (!mediaDoc.manifest) mediaDoc.manifest = {};
            if (!Array.isArray(mediaDoc.manifest.mediaParts)) mediaDoc.manifest.mediaParts = [];

            mediaDoc.manifest.mediaParts[index] = route;
            mediaDoc.state = "uploading";

            if(mediaDoc.manifest.chunksNumber === mediaDoc.manifest.mediaParts.length) {
                mediaDoc.state = "await_data";
            }

            const saved = await mediaDoc.save();

            wsMessage(ws, "uploadFeedback", {
                received: msgContext,
                data: saved.toObject(),
            });

            return;
        } else if (type === "metaUpdate") {
            // updates the data for the media like title description etc ... ... ...
            const { doc } = msgContext;
            const { bracket, characters, description, title, isPrivate } = doc;

            if (bracket) mediaDoc.bracket = bracket;
            if (characters) mediaDoc.characters = characters;
            if (description) mediaDoc.description = description;
            if (title) mediaDoc.title = title;
            if (typeof isPrivate === "boolean") mediaDoc.isPrivate = isPrivate;

            const saved = await mediaDoc.save();

            wsMessage(ws, "metaUpdate", {
                received: msgContext,
                data: saved.toObject(),
            });
        } else if (type === "getThumbnailImageUpload") {
            // issue a thumbnail post url

            const bucket = "quarantine-uploads";
            const keyId = `videos/${mediaDoc._id}/thumbnail`;

            const url = await uploadPresignLink({ bucket, keyId });

            wsMessage(ws, "getThumbnailImageUpload", {
                received: msgContext,
                url: url,
            });

            return;
        } else if (type === "thumbnailUpdate") {
            // update the thumbnail and the path in bucket

            const { path } = msgContext;

            if (path) {
                if (!mediaDoc.manifest) mediaDoc.manifest = {};

                mediaDoc.manifest.thumbnail = path;

                const saved = await mediaDoc.save();

                wsMessage(ws, "thumbnailUpdate", {
                    received: msgContext,
                    data: saved.toObject(),
                });
            }
        } else if (type === "finalize") {
            // finalize the media after all required upload metadata is complete
            const { partsCount } = msgContext;
            const mediaParts = mediaDoc.manifest?.mediaParts;
            const thumbnail = mediaDoc.manifest?.thumbnail;

            if (!Number.isInteger(partsCount) || partsCount <= 0) {
                wsMessage(ws, "error", "Finalize requires partsCount");
                return;
            }

            if (typeof mediaDoc.title !== "string" || mediaDoc.title.trim().length === 0) {
                wsMessage(ws, "error", "Finalize requires title");
                return;
            }

            if (
                typeof mediaDoc.description !== "string"
                // || mediaDoc.description.trim().length === 0
            ) {
                wsMessage(ws, "error", "Finalize requires description");
                return;
            }

            if (typeof mediaDoc.bracket === "undefined" || mediaDoc.bracket === null) {
                wsMessage(ws, "error", "Finalize requires bracket");
                return;
            }

            if (!mediaDoc.manifest || !Array.isArray(mediaParts)) {
                wsMessage(ws, "error", "Finalize requires uploaded media parts");
                return;
            }

            if (mediaParts.length !== partsCount) {
                wsMessage(ws, "error", "Finalize requires uploaded media parts");
                return;
            }

            if (mediaParts.some((part) => typeof part !== "string" || part.trim().length === 0)) {
                wsMessage(ws, "error", "Finalize requires uploaded media parts");
                return;
            }

            if (typeof thumbnail !== "string" || thumbnail.trim().length === 0) {
                wsMessage(ws, "error", "Finalize requires thumbnail");
                return;
            }

            mediaDoc.state = "done";

            const saved = await mediaDoc.save();

            await finalizeUploadCache(saved._id.toString());

            wsMessage(ws, "finalize", {
                received: msgContext,
                data: saved.toObject(),
            });
        }
    } catch (error) {
        console.error("[UploadHandler] failed", error);
        wsMessage(ws, "error", `Upload handler failed ${error}`);
    }
}
