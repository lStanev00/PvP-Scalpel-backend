import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
} from "discord.js";

const characters = []; // todo here see redis cache options and helers get the latest 25 characters retrived from cacehc the are cached and return em name-realm-server

export async function joinAutocompleteHandler(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const filtered = characters
        .filter((character) => {
            return (
                character.name.toLowerCase().includes(focused) ||
                character.value.toLowerCase().includes(focused)
            );
        })
        .slice(0, 25);

    await interaction.respond(filtered);
}

export async function joinButtonHandler(interaction) { // todo we need a option where the user can select alts alt mean other characters he want to get in the guild 
    if (interaction.customId.startsWith("join_confirm:")) {
        const character = interaction.customId.slice("join_confirm:".length);

        await interaction.update({
            content: [
                "## Joined",
                `Character: \`${character}\``,
                "",
                "State updated: `confirmed`",
            ].join("\n"),
            components: [],
        });

        return true;
    }

    if (interaction.customId === "join_cancel") {
        await interaction.update({
            content: ["## Cancelled", "State updated: `cancelled`"].join("\n"),
            components: [],
        });

        return true;
    }

    return false;
}

export default async function joinHandler(interaction) {
    const character = interaction.options.getString("character", true);

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`join_confirm:${character}`)
            .setLabel("Confirm Join")
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId("join_cancel")
            .setLabel("Cancel")
            .setStyle(ButtonStyle.Secondary),
    );

    //todo tell the user to go search a THE MAIN character at pvpscalpel.com and come back with a link 

    await interaction.reply({
        content: [
            "## PvP Scalpel Join",
            `Selected character: \`${character}\``,
            "",
            "Confirm if this is the correct character.",
        ].join("\n"),
        components: [row],
        flags: MessageFlags.Ephemeral,
    });
}
