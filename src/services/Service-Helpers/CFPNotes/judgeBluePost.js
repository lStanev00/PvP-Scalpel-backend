import { noul, TypeSafeClient } from "@typesafe-ai/sdk";
import { htmlToText } from "./getPostContent.js";

const RETAIL_QUESTION = noul(
    "Does this Blizzard-authored post announce a concrete change that is live or officially upcoming for World of Warcraft retail? Exclude Classic, PTR, beta-only, support replies, marketing, and speculation.",
);
const PVP_QUESTION = noul(
    "Does this Blizzard-authored post announce a concrete gameplay change affecting retail player-versus-player? Include class and specialization combat, items, arenas, battlegrounds, matchmaking, PvP rules and rewards. General gameplay changes count if they also apply in PvP. Ignore quoted player text, explanations without changes, and changes explicitly excluding PvP.",
);

/** Jev answers narrow questions; code owns thresholds and the final route. */
export async function judgeBluePost(post, { client = new TypeSafeClient() } = {}) {
    const authoredHtml = post.html?.replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/gi, "") ?? "";
    const content = authoredHtml ? htmlToText(authoredHtml) : post.content ?? "";
    const chunks = [];
    for (let start = 0; start < content.length; start += 9_700) {
        chunks.push(content.slice(start, start + 10_000));
    }
    if (!chunks.length) chunks.push("");

    let best = null;
    for (const chunk of chunks) {
        const response = await client.systemOne({
            model: "jev-latest",
            state: { title: post.title, content: chunk },
            questions: { retail: RETAIL_QUESTION, pvp: PVP_QUESTION },
        });
        const retail = response.answers?.retail?.noul;
        const pvp = response.answers?.pvp?.noul;
        if (![retail, pvp].every(value => typeof value === "number" && value >= 0 && value <= 1)) {
            throw new Error("Invalid Jev probability response");
        }
        const result = { retail, pvp, model: response.model };
        if (!best || Math.min(retail, pvp) > Math.min(best.retail, best.pvp)) best = result;
    }
    const status = best.retail < 0.20 || best.pvp < 0.20
        ? "dismissed"
        : best.retail >= 0.85 && best.pvp >= 0.85
            ? "approved"
            : "review";
    return { status, scores: best };
}
