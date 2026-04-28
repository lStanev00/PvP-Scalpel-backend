// version: 1.0.0

// This is a discord bot
// the name of the file is the name of the bot
// this file is used as index.js alike

import "dotenv/config";
import { Client, Events, GatewayIntentBits, Partials } from "discord.js";
import { configDotenv } from "dotenv";
import botRouter from "./src/botRouter.js";
import "./src/botCommands.js";
import messageRouter from "./src/messageRouter.js";
import threadBoot from "../helpers/threadBoot.js";

configDotenv({ path: "src/bot/bot.env" });

await threadBoot();

const messageCommandsEnabled = process.env.DISCORD_MESSAGE_COMMANDS === "true";

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.DirectMessages,
        ...(messageCommandsEnabled
            ? [GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
            : []),
    ],
    partials: [Partials.Channel],
});

client.once(Events.ClientReady, () => {
    console.log(`Zugee online as ${client.user.tag}`);
    console.log(
        `DM message commands enabled. Guild message commands: ${messageCommandsEnabled ? "enabled" : "disabled"}.`,
    );
});

client.on(Events.InteractionCreate, botRouter);

client.on(Events.MessageCreate, async (message) => {
    await messageRouter(message, { messageCommandsEnabled });
});

if (!messageCommandsEnabled) {
    console.info(
        "Guild message commands disabled. DM the bot with !search-dump, or set DISCORD_MESSAGE_COMMANDS=true and enable Message Content Intent for guild message commands.",
    );
}

await client.login(process.env.DISCORD_TOKEN);
