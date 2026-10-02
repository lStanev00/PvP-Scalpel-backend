import Service from "../../../Models/Services.js";
import setCache from "../../../helpers/redis/setterRedis.js";
import analyzePNotes, { PNotesValidationError } from "./analyzePNotes.js";
import generatePNotesSummaryCard from "./generatePNotesSummaryCard.js";

/** Prepare a durable Discord payload. Non-class PvP updates use a link alone. */
export async function preparePNotesPayload(post, {
    analyze = analyzePNotes,
    render = generatePNotesSummaryCard,
} = {}) {
    const payload = { title: post.title, url: post.url };
    let analysis;
    try {
        analysis = await analyze(post);
    } catch (error) {
        if (!(error instanceof PNotesValidationError)) throw error;
        payload.validationFailure = { reasons: [...error.reasons] };
        if (error.analysis) {
            try { payload.cardBuffer = await render(error.analysis, post); }
            catch { payload.validationFailure.reasons.push("Rejected analysis could not be rendered."); }
        }
        return payload;
    }
    if (analysis.changes.classes.length || analysis.changes.specs.length) {
        payload.cardBuffer = await render(analysis, post);
    }
    return payload;
}

/** Legacy publisher retained for callers that use Redis directly. */
export default async function publishPNotes(post, {
    publish,
    docID,
    cache = setCache,
    saveHandled = (id, postId) => Service.updateOne({ _id: id }, { $addToSet: { data: String(postId) } }),
    analyze = analyzePNotes,
    render = generatePNotesSummaryCard,
}) {
    const payload = await preparePNotesPayload(post, { analyze, render });
    await publish("annoDiscord:newClassChanges", JSON.stringify(payload));
    await cache("CFPNotes", post.id);
    await saveHandled(docID, post.id);
    return payload;
}
