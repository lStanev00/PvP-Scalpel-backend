import "dotenv/config";
import { REST, Routes, SlashCommandBuilder } from "discord.js";
import { configDotenv } from "dotenv";
configDotenv({path: "src/bot/bot.env"})

const commands = [
    new SlashCommandBuilder()
        .setName("ping")
        .setDescription("Check if Zugee is online.")
        .toJSON(),

    new SlashCommandBuilder()
        .setName("info")
        .setDescription("Show PvP Scalpel bot information.")
        .toJSON(),

    new SlashCommandBuilder()
        .setName("search-dump")
        .setDescription("Test test feat (console.info())")
        .toJSON()
];

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

await rest.put(
    Routes.applicationGuildCommands(
        process.env.DISCORD_CLIENT_ID,
        process.env.DISCORD_GUILD_ID
    ),
    { body: commands }
);

console.log("Discord slash commands registered.");