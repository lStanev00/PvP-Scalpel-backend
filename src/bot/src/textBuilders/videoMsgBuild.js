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

        const endURL = `https://www.pvpscalpel.com/watch/${videoDoc._id}`;

        const title = videoDoc.title?.trim() || "Untitled PvP Clip";
        const description = videoDoc.description?.trim();

        const msg = `🎬 **NEW VIDEO ON PvP SCALPEL**

🔥 **${title}**

${description ? `${description}\n\n` : ""}⚔️ ${videoDoc.author?.username ? `Uploaded by **${videoDoc.author.username}**\n\n` : ""}▶️ **Watch now:** ${endURL}`;

        return msg;
    } catch (error) {
        console.error("Failed to build video announcement:", error);
        return null;
    }
}
