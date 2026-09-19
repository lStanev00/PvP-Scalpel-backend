import analyzePNotes, { PNotesValidationError } from "./analyzePNotes.js";
import generatePNotesSummaryCard from "./generatePNotesSummaryCard.js";

/** Prepare one normal or rejected announcement; cache only after publishing it. */
export default async function publishPNotes(post, {
    publish,
    cache,
    analyze = analyzePNotes,
    render = generatePNotesSummaryCard,
}) {
    const payload = { title: post.title, url: post.url };
    let analysis;
    try {
        analysis = await analyze(post);
    } catch (error) {
        if (!(error instanceof PNotesValidationError)) throw error;
        payload.validationFailure = { reasons: [...error.reasons] };
        if (error.analysis) {
            try {
                payload.cardBuffer = await render(error.analysis, post);
            } catch {
                payload.validationFailure.reasons.push("Rejected analysis could not be rendered.");
            }
        }
    }
    if (!payload.validationFailure) payload.cardBuffer = await render(analysis, post);
    await publish("annoDiscord:newClassChanges", JSON.stringify(payload));
    await cache("CFPNotes", post.id);
    return payload;
}
