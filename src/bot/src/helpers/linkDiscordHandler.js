import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from "discord.js";

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

    if (!hash) { // validate hash 
        await interaction.reply({
            content: "Could not generate a Discord link code. Try again in a bit.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    //build button
    const linkUrl = buildDiscordLinkUrl(hash);
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel("Link Discord Account")
            .setStyle(ButtonStyle.Link)
            .setURL(linkUrl),
    );

    await interaction.reply({
        content: [
            "🔗 **Connect your Discord account**",
            "",
            "Press the button below to link your Discord account with **PvP Scalpel**.",
            "",
            "Only you can see this message.",
        ].join("\n"),
        components: [row],
        flags: MessageFlags.Ephemeral,
    });
}
