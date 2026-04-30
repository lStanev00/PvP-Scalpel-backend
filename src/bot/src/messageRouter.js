import { promptAiGateway } from "./helpers/aiGatewayChat.js";

const TEAM_ROLE_IDS = new Set(["1318113244963012638", "1422201563555958885"]);
const DISCORD_MESSAGE_LIMIT = 2000;
const DISCORD_SAFE_MESSAGE_LIMIT = 1900;
const SEARCH_DUMP_DISABLED_MESSAGE =
    "Zugee does not send search dumps through DMs anymore. Send me a normal question and I will help in plain Discord chat.";
const UNAUTHORIZED_MESSAGE =
    "Zugee is still only talking with the PvP Scalpel team right now. If you think you should have access, ping the team.";
const THINKING_MESSAGE = "Zugee is thinking...";
const AI_ERROR_MESSAGE = "Zugee could not reach the AI gateway right now. Try again in a bit.";

function isSearchDumpCommand(content) {
    return /^!search[-\s]?dump\b/i.test(content);
}

function splitDiscordMessage(content) {
    if (content.length <= DISCORD_MESSAGE_LIMIT) return [content];

    const chunks = [];
    let remaining = content;

    while (remaining.length > 0) {
        if (remaining.length <= DISCORD_SAFE_MESSAGE_LIMIT) {
            chunks.push(remaining);
            break;
        }

        const slice = remaining.slice(0, DISCORD_SAFE_MESSAGE_LIMIT);
        const splitAt = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf(" "));
        const end = splitAt > 500 ? splitAt : DISCORD_SAFE_MESSAGE_LIMIT;

        chunks.push(remaining.slice(0, end).trimEnd());
        remaining = remaining.slice(end).trimStart();
    }

    return chunks;
}

async function userHasTeamRole(message) {
    const guildId = process.env.DISCORD_GUILD_ID?.trim();

    if (!guildId) {
        throw new Error("DISCORD_GUILD_ID is required for Zugee DM role guard.");
    }

    const guild = await message.client.guilds.fetch(guildId);
    let member;

    try {
        member = await guild.members.fetch(message.author.id);
    } catch {
        return false;
    }

    return member.roles.cache.some((role) => TEAM_ROLE_IDS.has(role.id));
}

async function replyWithChunks(message, firstReply, content) {
    const chunks = splitDiscordMessage(content);
    await firstReply.edit(chunks[0]);

    for (const chunk of chunks.slice(1)) {
        await message.channel.send(chunk);
    }
}

export default async function messageRouter(message, { messageCommandsEnabled = false } = {}) {
    try {
        if (message.author.bot) return;
        if (message.guildId && !messageCommandsEnabled) return;

        const content = message.content?.trim() ?? "";
        if (!content) return;

        if (!message.guildId) {
            if (isSearchDumpCommand(content)) {
                await message.reply(SEARCH_DUMP_DISABLED_MESSAGE);
                return;
            }

            if (!(await userHasTeamRole(message))) {
                await message.reply(UNAUTHORIZED_MESSAGE);
                return;
            }

            const thinkingReply = await message.reply(THINKING_MESSAGE);
            try {
                const aiResponse = await promptAiGateway(content, message.author.id);
                await replyWithChunks(message, thinkingReply, aiResponse);
            } catch (error) {
                console.error("[Zugee] AI gateway DM failed", error);
                await thinkingReply.edit(AI_ERROR_MESSAGE);
            }

            return;
        }

        if (!isSearchDumpCommand(content)) return;
        await message.reply(SEARCH_DUMP_DISABLED_MESSAGE);
    } catch (error) {
        console.error("[Zugee] message command failed", error);

        try {
            await message.reply(AI_ERROR_MESSAGE);
        } catch (replyError) {
            console.error("[Zugee] failed to send error reply", replyError);
        }
    }
}
