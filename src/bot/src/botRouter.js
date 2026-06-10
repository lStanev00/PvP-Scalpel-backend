import { MessageFlags } from "discord.js";
import infoHandler from "./botHandlers/infoHandler.js";
import joinHandler, {
    joinAutocompleteHandler,
    joinButtonHandler,
    joinModalHandler,
} from "./botHandlers/joinHandler.js";
import linkDiscordHandler from "./helpers/linkDiscordHandler.js";
import pingHandler from "./botHandlers/pingHandler.js";
import searchHandler from "./botHandlers/searchHandler.js";
import unknownHandler from "./botHandlers/unknownHandler.js";

function isUnknownInteractionError(error) {
    return error?.code === 10062 || error?.rawError?.code === 10062;
}

async function sendInteractionErrorResponse(interaction, response) {
    try {
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(response);
            return;
        }

        await interaction.reply(response);
    } catch (replyError) {
        if (isUnknownInteractionError(replyError)) {
            console.warn("[Zugee] interaction expired before an error response could be sent.");
            return;
        }

        console.error("[Zugee] failed to send interaction error response", replyError);
    }
}

async function handleInteractionError(interaction, error) {
    if (isUnknownInteractionError(error)) {
        console.warn("[Zugee] interaction expired before it could be acknowledged.");
        return;
    }

    if (!interaction.isRepliable()) return;

    console.error("[Zugee] interaction failed", error);

    const response = {
        content: "Interaction failed. Check bot logs.",
        flags: MessageFlags.Ephemeral,
    };

    await sendInteractionErrorResponse(interaction, response);
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

        if (!interaction.guildId) {
            await interaction.reply({
                content: "Zugee slash commands are server-only. Send me a normal DM for AI chat.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

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
            case "link":
                return await linkDiscordHandler(interaction);
            default:
                return await unknownHandler(interaction);
        }
    } catch (error) {
        await handleInteractionError(interaction, error);
    }
}
