import { MessageFlags } from "discord.js";
import { generateLinkDiscordHash } from "../../../caching/linkDiscordCache/linkDiscord.js";

const defaultLinkBaseUrl = "https://www.pvpscalpel.com/linkDiscord";

function getLinkBaseUrl() {
    return (process.env.DISCORD_LINK_BASE_URL || defaultLinkBaseUrl).replace(/\/+$/, "");
}

function buildDiscordLinkUrl(hash) {
    const url = new URL(getLinkBaseUrl());
    url.searchParams.set("code", hash);
    return url.toString();
}

export default async function linkDiscordHandler(interaction) {
    const hash = await generateLinkDiscordHash(interaction.user.id);

    if (!hash) {
        await interaction.reply({
            content: "Could not generate a Discord link code. Try again in a bit.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    await interaction.reply({
        content: `Link your Discord account here:\n${buildDiscordLinkUrl(hash)}`,
        flags: MessageFlags.Ephemeral,
    });
}
