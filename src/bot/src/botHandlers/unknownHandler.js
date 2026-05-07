import { MessageFlags } from "discord.js";

export default async function unknownHandler(interaction) {
    if (!interaction.isRepliable()) return;

    const response = {
        content: "Unknown command.",
        flags: MessageFlags.Ephemeral,
    };

    if (interaction.replied || interaction.deferred) {
        await interaction.followUp(response);
        return;
    }

    await interaction.reply(response);
}
