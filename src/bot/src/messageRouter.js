import { fetchSearchDump } from "./helpers/searchDump.js";

export default async function messageRouter(message, { messageCommandsEnabled = false } = {}) {
    try {
        if (message.author.bot) return;
        if (message.guildId && !messageCommandsEnabled) return;

        const content = message.content.trim();
        if (!content.startsWith("!search-dump")) return;

        const search = content.slice("!search-dump".length).trim();
        if (!search) {
            await message.reply("Usage: `!search-dump lychezar-chamber-eu`");
            return;
        }

        console.log(`[Zugee] search-dump from ${message.guildId ? "guild" : "dm"}: ${search}`);
        await message.reply(await fetchSearchDump(search));
    } catch (error) {
        console.error("[Zugee] message command failed", error);

        try {
            await message.reply("Search dump failed. Check bot logs for details.");
        } catch (replyError) {
            console.error("[Zugee] failed to send error reply", replyError);
        }
    }
}
