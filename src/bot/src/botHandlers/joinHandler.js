import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from "discord.js";
import { RESTFetch } from "../../../helpers/RESTFetch.js";

const baseFEUrl = "https://www.pvpscalpel.com";

const charRetrive = async (searchString) => {
    const [name, realmSlug, server] = searchString.split(":");
    const RESTUrlBuild = new URL()
    const res = await RESTFetch(`/checkCharacter/${server}/${realmSlug}}/${name}`);
    if (res.status === 200) return `/check/${server}/${realmSlug}/${name}`;
}

export async function joinAutocompleteHandler(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const res = await RESTFetch("/checkCharacter/getLatest25");

    if (res.status !== 200 || !Array.isArray(res.data)) {
        await interaction.respond([]);
        return true;
    }

    const choices = [];

    for (const { _id, name, playerRealm, server } of res.data) {
        const label = [name, playerRealm?.name, server].filter(Boolean).join(" - ");
        const value = [name, playerRealm?.slug || playerRealm?.name, server].filter(Boolean).join(":");

        if (!focused || label.toLowerCase().includes(focused)) {
            choices.push({
                name: label.slice(0, 100),
                value: value.slice(0, 100),
            });
        }

        if (choices.length === 25) break;
    }

    await interaction.respond(choices);
    return true;
}

export async function joinButtonHandler(interaction) {
    if (interaction.customId.startsWith("join_confirm:")) {
        const charactersMeta = interaction.customId.slice("join_confirm:".length);
        const charList = charactersMeta.split("|");
        const main = charList.shift();

        const content = ["## Aplied", `main: [${}]`];

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
    } else if(interaction.customId.startsWith("join_confirm:")) {

    } else if (interaction.customId === "join_cancel") {
        await interaction.update({
            content: ["## Cancelled", "State updated: `cancelled`"].join("\n"),
            components: [],
        });

        return true;
    }

    return false;
}

export default async function joinHandler(interaction) {
    const characters = interaction.options.getString("character", true);

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`join_confirm:${character}`)
            .setLabel("Confirm Join")
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId("join_add_alt")
            .setLabel("Add alt")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("join_cancel")
            .setLabel("Cancel")
            .setStyle(ButtonStyle.Secondary),
    );

    await interaction.reply({
        content: [
            "## PvP Scalpel Join",
            `Selected character: \`${character}\``,
            "",
            "Confirm if this is the correct character or add more alts to join with.",
        ].join("\n"),
        components: [row],
        flags: MessageFlags.Ephemeral,
    });
}
