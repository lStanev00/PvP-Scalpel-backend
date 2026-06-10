import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from "discord.js";

import { generateLinkDiscordHash } from "../../../caching/linkDiscordCache/linkDiscord.js";

const defaultLinkBaseUrl = "https://www.pvpscalpel.com/linkDiscord";

/**
 * Reads the configured Discord account-linking URL and normalizes trailing slashes.
 *
 * @returns {string} Absolute base URL used for Discord account-link links.
 */
function getLinkBaseUrl() {
    return (process.env.DISCORD_LINK_BASE_URL || defaultLinkBaseUrl).replace(/\/+$/, "");
}

/**
 * Builds the frontend URL that receives a generated Discord link hash.
 *
 * @param {string} hash - Temporary link hash generated for the Discord user.
 * @returns {string} Account-link URL with the hash attached as the `code` query parameter.
 */
function buildDiscordLinkUrl(hash) {
    const url = new URL(getLinkBaseUrl());
    url.searchParams.set("code", hash);
    return url.toString();
}

/**
 * Handles the `/link` Discord slash command by generating a private account-linking URL.
 *
 * @param {import("discord.js").ChatInputCommandInteraction} interaction - Discord slash command interaction.
 * @returns {Promise<void>}
 */
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
