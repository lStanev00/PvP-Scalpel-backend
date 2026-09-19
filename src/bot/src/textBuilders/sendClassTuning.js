import { MessageFlags } from "discord.js";

const NEWS_CHANNEL = "1548298695022215188";
const DIAGNOSTIC_USER = "348181106878840832";

/** Send the public announcement and, on validation failure, a private diagnostic. */
export default async function sendClassTuning(client, payload, logger = console) {
    const { title, url, cardBuffer, validationFailure } = payload;
    if (typeof title !== "string" || !title || typeof url !== "string" || !url ||
        (!cardBuffer && !validationFailure)) throw new Error("Invalid class tuning announcement payload");
    if (validationFailure && (!Array.isArray(validationFailure.reasons) ||
        !validationFailure.reasons.every(reason => typeof reason === "string"))) {
        throw new Error("Invalid class tuning validation failure");
    }
    const link = `### [${title.replaceAll("\\", "\\\\").replaceAll("]", "\\]")}](${url})`;
    const options = { allowedMentions: { parse: [] }, flags: MessageFlags.SuppressEmbeds };
    const imageFiles = () => cardBuffer ? [{
        attachment: Buffer.isBuffer(cardBuffer) ? cardBuffer : Buffer.from(cardBuffer.data),
        name: validationFailure ? "UNVERIFIED-class-tuning.png" : "class-tuning.png",
        description: validationFailure ? "UNVERIFIED — rejected analysis" : "PvP Scalpel class tuning quick overview",
    }] : [];
    const channel = await client.channels.fetch(NEWS_CHANNEL);
    if (!channel?.isTextBased()) throw new Error("Class tuning news channel is unavailable");
    await channel.send({ ...options, content: link, ...(!validationFailure ? { files: imageFiles() } : {}) });
    if (!validationFailure) return;

    try {
        const user = await client.users.fetch(DIAGNOSTIC_USER);
        await user.send({
            ...options,
            content: (`${link}\n**UNVERIFIED — analysis rejected. Only the link was posted publicly.**\n` +
                validationFailure.reasons.map(reason => `• ${reason}`).join("\n")).slice(0, 1950),
            files: [
                ...imageFiles(),
                { attachment: Buffer.from(validationFailure.reasons.join("\n")), name: "validation-errors.txt" },
            ],
        });
    } catch (error) {
        logger.error("Failed to DM class tuning diagnostics:", error);
    }
}
