import { Router } from "express";
import { createMediaPOST, requireAdmin } from "./route_logic/mediaCTRL/createMediaPOST.js";
import userMediaGET from "./route_logic/mediaCTRL/userMediaGET.js";
import updateMediaPATCH from "./route_logic/mediaCTRL/updateMediaPATCH.js";
import finalizeMediaPATCH from "./route_logic/mediaCTRL/finalizeMediaPATCH.js";
import acknowledgeMediaPartPATCH from "./route_logic/mediaCTRL/acknowledgeMediaPartPATCH.js";
import MediaMeta from "../Models/MediaMeta.js";
import { jsonMessage, jsonResponse } from "../helpers/resposeHelpers.js";

const mediaCTRL = Router();

mediaCTRL.post("/media", requireAdmin, createMediaPOST);
mediaCTRL.patch("/media/upload-part", requireAdmin, acknowledgeMediaPartPATCH);
mediaCTRL.patch("/media", updateMediaPATCH);
// mediaCTRL.patch("/media/finnalize", requireAdmin, finalizeMediaPATCH);
mediaCTRL.patch("/media/finnalize", finalizeMediaPATCH);
mediaCTRL.get("/userMedia", requireAdmin, userMediaGET);

// specifical controllers for the videos;
mediaCTRL.get("/videos", getVideos);
mediaCTRL.get("/video/:videoID", getVideo);

async function getVideos(_, res) {
    try {
        const docs = await MediaMeta.find({
            type: "video",
            state: "done",
            censored: false,
            isPrivate: false,
            quarantined: false,
        })
            .select(
                "title author views bracket manifest.video manifest.playlist manifest.thumbnail",
            )
            .sort({ views: -1 })
            .lean();

        if (docs) return jsonResponse(res, 200, docs);
        else return jsonResponse(res, 404);
    } catch (error) {
        console.error(error);
        return jsonResponse(res, 500);
    }
}

async function getVideo(req, res) {
    const { videoID } = req.params;

    try {
        const videoDoc = await MediaMeta.findByIdAndUpdate(
            videoID,
            {
                $inc: { views: 1 },
            },
            { new: true },
        )
            .select(
                "title author views bracket manifest.video manifest.playlist manifest.thumbnail isPrivate censored likes description",
            )
            .populate({
                path: "author",
                select: "username",
            })
            .populate({ path: "comments" })
            .populate({ path: "characters" })
            .lean();

        if (!videoDoc) return jsonMessage(res, 404, "Video not found");

        if (videoDoc.isPrivate) {
            return jsonResponse(res, 403);
        } else if (videoDoc.censored) {
            return jsonResponse(res, 451);
        }

        if (videoDoc) return jsonResponse(res, 200, videoDoc);
        else return jsonResponse(res, 404);
    } catch (error) {
        console.error(error);
        return jsonResponse(res, 500);
    }
}

export default mediaCTRL;
