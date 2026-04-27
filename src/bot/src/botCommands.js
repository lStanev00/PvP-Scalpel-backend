import "dotenv/config";
import { REST, Routes, SlashCommandBuilder } from "discord.js";
import { configDotenv } from "dotenv";

configDotenv({ path: "src/bot/bot.env" });

const commandBuilders = [
    new SlashCommandBuilder()
        .setName("ping")
        .setDescription("Check if Zugee is online."),

    new SlashCommandBuilder()
        .setName("info")
        .setDescription("Show PvP Scalpel bot information."),

    new SlashCommandBuilder()
        .setName("search-dump")
        .setDescription("Dump normalized character search API data.")
        .addStringOption((option) =>
            option
                .setName("search")
                .setDescription("Character search, e.g. lychezar-chamber-eu")
                .setRequired(true),
        ),

    new SlashCommandBuilder()
        .setName("search-char")
        .setDescription("Search for a character")
        .addStringOption((option) =>
            option
                .setName("search")
                .setDescription('Character search separated by "-", e.g. name-realm-server')
                .setRequired(true),
        ),

    new SlashCommandBuilder()
        .setName("join")
        .setDescription("Join PvP Scalpel with a character")
        .addStringOption((option) =>
            option
                .setName("character")
                .setDescription("Start typing your character")
                .setRequired(true)
                .setAutocomplete(true),
        ),
];

const commands = commandBuilders.map((command) => command.toJSON());
const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

await rest.put(
    Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
    { body: commands },
);

console.log("Discord slash commands registered.");
