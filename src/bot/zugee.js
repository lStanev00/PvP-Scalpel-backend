// version: 0.0.0

// This is a discord bot
// the name of the file is the name of the bot
// this file is used as index.js alike 

import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { configDotenv } from "dotenv";
import "./src/botCommands.js";

configDotenv({path: "src/bot/bot.env"})

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds
    ]
});

client.once("clientReady", () => {
    console.log(`Zugee online as ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) {
        return;
    }

    if (interaction.commandName === "ping") {
        await interaction.reply("Pong. Zugee is online.");
        return;
    }

    if (interaction.commandName === "info") {
        await interaction.reply("Zugee is the PvP Scalpel Discord bot.");
        return;
    }
});

await client.login(process.env.DISCORD_TOKEN);