import { enqueueMediaJob } from "../../../caching/charQueueCache/jobQueueCache.js";
import { jsonMessage, jsonResponse } from "../../../helpers/resposeHelpers.js";
import MediaMeta from "../../../Models/MediaMeta.js";

export default async function finalizeMediaPATCH(req, res) {
    const { user } = req;
    const { _id } = req.body;

    if (!user) return jsonMessage(res, 403, "no Auth");
    try {
        const mediaDoc = await MediaMeta.findById(_id);
        if (!mediaDoc) return jsonMessage(res, 404, "The media with this id does not exist");
        
        if (mediaDoc.author.toString() !== user._id.toString()) return jsonResponse(res, 499);
        mediaDoc.state = "need_process";
        await mediaDoc.save();

        const job = await enqueueMediaJob(mediaDoc.id);
        
        if (job) {
            return jsonResponse(res, 201, mediaDoc.toObject());
        } else if (job === 0) {
            return jsonResponse(res, 409, mediaDoc.toObject());
        } else {
            return jsonMessage(res, 500, "There's a problem with this task");
        }
    } catch (error) {
        console.warn(`error at finalizeMediaPATCH`);
        console.error(error);
        return jsonResponse(res, 500);
    }
}
