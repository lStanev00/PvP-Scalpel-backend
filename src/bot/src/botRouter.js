import { MessageFlags } from "discord.js";
import infoHandler from "./botHandlers/infoHandler.js";
import joinHandler, {
    joinAutocompleteHandler,
    joinButtonHandler,
    joinModalHandler,
} from "./botHandlers/joinHandler.js";
import pingHandler from "./botHandlers/pingHandler.js";
import searchHandler from "./botHandlers/searchHandler.js";
import unknownHandler from "./botHandlers/unknownHandler.js";

async function handleInteractionError(interaction, error) {
    console.error("[Zugee] interaction failed", error);

    if (!interaction.isRepliable()) return;

    const response = {
        content: "Interaction failed. Check bot logs.",
        flags: MessageFlags.Ephemeral,
    };

    if (interaction.replied || interaction.deferred) {
        await interaction.followUp(response);
        return;
    }

    await interaction.reply(response);
}

export default async function botRouter(interaction) {
    try {
        if (interaction.isAutocomplete()) {
            if (interaction.commandName === "join") {
                await joinAutocompleteHandler(interaction);
            }

            return;
        }

        if (interaction.isButton()) {
            const handled = await joinButtonHandler(interaction);
            if (!handled) await unknownHandler(interaction);
            return;
        }

        if (interaction.isModalSubmit()) {
            const handled = await joinModalHandler(interaction);

            if (handled) return;
        }

        if (!interaction.isChatInputCommand()) return;

        switch (interaction.commandName) {
            case "ping":
                return await pingHandler(interaction);
            case "info":
                return await infoHandler(interaction);
            case "search-dump":
            case "search-char":
                return await searchHandler(interaction);
            case "join":
                return await joinHandler(interaction);
            default:
                return await unknownHandler(interaction);
        }
    } catch (error) {
        await handleInteractionError(interaction, error);
    }
}
