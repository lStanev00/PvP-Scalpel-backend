// version: 1.1.1

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
const rawDmFallbackTimers = new Map();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
        ...(messageCommandsEnabled
            ? [GatewayIntentBits.GuildMessages]
            : []),
    ],
    partials: [Partials.Channel, Partials.Message, Partials.User],
});

client.once(Events.ClientReady, () => {
    console.log(`Zugee online as ${client.user.tag}`);
    console.log(
        `DM AI chat enabled for team roles. Guild message commands: ${messageCommandsEnabled ? "enabled" : "disabled"}.`,
    );
});

client.on(Events.InteractionCreate, botRouter);

client.on(Events.Raw, (packet) => {
    if (packet.t !== "MESSAGE_CREATE") return;

    if (packet.d?.guild_id) return;
    if (packet.d?.author?.bot) return;

    const messageId = packet.d.id;
    const timer = setTimeout(async () => {
        rawDmFallbackTimers.delete(messageId);

        try {
            const channel = await client.channels.fetch(packet.d.channel_id);
            if (!channel?.isSendable()) return;

            await messageRouter(
                {
                    id: packet.d.id,
                    content: packet.d.content ?? "",
                    guildId: null,
                    client,
                    channel,
                    author: {
                        id: packet.d.author?.id,
                        bot: Boolean(packet.d.author?.bot),
                    },
                    reply: (content) => channel.send(content),
                },
                { messageCommandsEnabled },
            );
        } catch (error) {
            console.error("[Zugee] raw DM message failed", error);
        }
    }, 250);

    rawDmFallbackTimers.set(messageId, timer);
});

client.on(Events.MessageCreate, async (message) => {
    const fallbackTimer = rawDmFallbackTimers.get(message.id);

    if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        rawDmFallbackTimers.delete(message.id);
    }

    await messageRouter(message, { messageCommandsEnabled });
});

if (!messageCommandsEnabled) {
    console.info(
        "Guild message commands disabled. Team members can DM Zugee for AI chat.",
    );
}

await client.login(process.env.DISCORD_TOKEN);
