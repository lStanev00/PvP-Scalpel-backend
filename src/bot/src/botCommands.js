import "dotenv/config";
import { REST, Routes, SlashCommandBuilder } from "discord.js";
import { configDotenv } from "dotenv";

configDotenv({ path: "src/bot/bot.env" });

const commandBuilders = [
    new SlashCommandBuilder()
        .setName("join")
        .setDescription("Join PvP Scalpel. Zugee will walk you throw an aplication.")
        .addStringOption((option) =>
            option
                .setName("character")
                .setDescription("Try finding your character or search it at pvpscalpel.com and paste the link there.")
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
