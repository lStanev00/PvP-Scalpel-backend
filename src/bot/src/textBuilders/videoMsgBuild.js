import { EmbedBuilder } from "discord.js";
import MediaMeta from "../../../Models/MediaMeta.js";

export default async function buildVideoAnno(videoID) {
    try {
        const videoDoc = await MediaMeta.findById(videoID)
            .populate({
                path: "author",
                select: "username",
            })
            .lean();

        if (!videoDoc) return null;

        const videoURL =
            `https://www.pvpscalpel.com/watch/${videoDoc._id}`;

        const title =
            videoDoc.title?.trim() || "New PvP Scalpel Video";

        const description =
            videoDoc.description?.trim() || "New PvP content is live.";

        const thumbnailKey = videoDoc.manifest?.thumbnail;
        const thumbnailURL = thumbnailKey
            ? new URL("pvp-scalpel-frontend/" + thumbnailKey, "https://bucket.pvpscalpel.com").href
            : null;

        const embed = new EmbedBuilder()
            .setAuthor({
                name: "PvP Scalpel • New Video",
            })
            .setTitle(`🔥 ${title}`)
            .setURL(videoURL)
            .setDescription(
                description.length > 250
                    ? `${description.slice(0, 250)}...`
                    : description,
            )
            .setFooter({
                text: `⚔️ ${videoDoc.author?.username ?? "Unknown"} • PvP Scalpel TV`,
            })
            .setTimestamp(videoDoc.createdAt);

        if (thumbnailURL) {
            embed.setImage(thumbnailURL);
        }

        return {
            embeds: [embed],
        };
    } catch (error) {
        console.error("Failed to build video announcement:", error);
        return null;
    }
}
