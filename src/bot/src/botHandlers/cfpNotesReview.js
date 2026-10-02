import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from "discord.js";
import CFPNotesPost from "../../../Models/CFPNotesPost.js";
import Service from "../../../Models/Services.js";
import sendClassTuning from "../textBuilders/sendClassTuning.js";

const REVIEW_CHANNEL = "1554476424042123335";
const REVIEW_ROLES = new Set(["1318113244963012638", "1422201563555958885"]);
const RETRY_AFTER_MS = 5 * 60 * 1000;

function reviewButtons(postId) {
    return [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`cfp:accept:${postId}`).setLabel("Accept").setEmoji("✅").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`cfp:dismiss:${postId}`).setLabel("Dismiss").setEmoji("❌").setStyle(ButtonStyle.Danger),
    )];
}

function reviewText(post) {
    const retail = Math.round(post.scores.retail * 100);
    const pvp = Math.round(post.scores.pvp * 100);
    return `⚠️ **Low confidence Blizzard post**\n` +
        `Jev could not confidently determine whether this post announces retail PvP gameplay changes. ` +
        `Review the source, then choose **✅ Accept** to publish or **❌ Dismiss** to discard.\n` +
        `**${post.title}**\n${post.url}\nRetail: ${retail}% · PvP: ${pvp}%`;
}

function hasReviewRole(interaction) {
    const roles = interaction.member?.roles;
    if (roles?.cache) return [...REVIEW_ROLES].some(id => roles.cache.has(id));
    if (Array.isArray(roles)) return roles.some(id => REVIEW_ROLES.has(id));
    return false;
}

export async function handleCFPNotesReviewButton(interaction) {
    const match = /^cfp:(accept|dismiss):(\d+)$/.exec(interaction.customId);
    if (!match) return false;
    if (interaction.channelId !== REVIEW_CHANNEL || !hasReviewRole(interaction)) {
        await interaction.reply({ content: "Only the review team can decide on this post.", flags: MessageFlags.Ephemeral });
        return true;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const [, action, postId] = match;
    const nextStatus = action === "accept" ? "approved" : "dismissed";
    const result = await CFPNotesPost.findOneAndUpdate(
        { postId, status: "review", reviewMessageId: interaction.message.id },
        { $set: { status: nextStatus, reviewMessageId: null } },
        { new: true },
    );
    if (!result) {
        await interaction.editReply("This post was already decided.");
        return true;
    }
    try { await interaction.message.delete(); }
    catch (error) { console.warn("[CFPNotes] Could not delete review message:", error); }
    await interaction.editReply(action === "accept"
        ? "Accepted. The worker will prepare the public announcement."
        : "Dismissed. No public announcement will be sent.");
    return true;
}

async function reconcileSending(client) {
    const stale = await CFPNotesPost.find({
        status: "sending", updatedAt: { $lt: new Date(Date.now() - RETRY_AFTER_MS) },
    });
    if (!stale.length) return;
    const channel = await client.channels.fetch("1548298695022215188");
    if (!channel?.isTextBased()) throw new Error("CFPNotes public channel unavailable");
    const recent = await channel.messages.fetch({ limit: 100 });
    for (const post of stale) {
        const existing = recent.find(message => message.author.id === client.user.id && message.content.includes(post.url));
        if (existing) {
            await markPublished(post, existing.id);
        } else {
            await CFPNotesPost.updateOne({ _id: post.id, status: "sending" }, { $set: { status: "ready" } });
        }
    }
}

async function markPublished(post, messageId) {
    await Service.updateOne({ service: "CFPNotes" }, { $addToSet: { data: post.postId } });
    await CFPNotesPost.updateOne(
        { _id: post.id, status: "sending" },
        { $set: { status: "published", publicMessageId: messageId, payload: null, lastError: null } },
    );
}

export async function flushCFPNotesQueue(client) {
    const reviewChannel = await client.channels.fetch(REVIEW_CHANNEL);
    if (!reviewChannel?.isTextBased()) throw new Error("CFPNotes review channel unavailable");

    const reviews = await CFPNotesPost.find({ status: "review", reviewMessageId: null }).sort({ postedAt: 1 });
    for (const post of reviews) {
        try {
            const message = await reviewChannel.send({
                content: reviewText(post), components: reviewButtons(post.postId),
                allowedMentions: { parse: [] }, nonce: `cfp-r-${post.postId}`, enforceNonce: true,
            });
            await CFPNotesPost.updateOne(
                { _id: post.id, status: "review", reviewMessageId: null },
                { $set: { reviewMessageId: message.id, lastError: null } },
            );
        } catch (error) {
            await CFPNotesPost.updateOne({ _id: post.id }, { $set: { lastError: String(error) } });
            console.error(`[CFPNotes] Review delivery failed for ${post.postId}:`, error);
        }
    }

    await reconcileSending(client);
    const ready = await CFPNotesPost.find({ status: "ready" }).sort({ postedAt: 1 });
    for (const post of ready) {
        const claimed = await CFPNotesPost.findOneAndUpdate(
            { _id: post.id, status: "ready" }, { $set: { status: "sending" } }, { new: true },
        );
        if (!claimed) continue;
        let message;
        try {
            message = await sendClassTuning(client, claimed.payload, console, {
                nonce: `cfp-p-${post.postId}`, enforceNonce: true,
            });
        } catch (error) {
            await CFPNotesPost.updateOne(
                { _id: post.id, status: "sending" },
                { $set: { status: "ready", lastError: String(error) } },
            );
            console.error(`[CFPNotes] Public delivery failed for ${post.postId}:`, error);
            continue;
        }
        try {
            await markPublished(claimed, message.id);
        } catch (error) {
            // Keep sending state: a retry must first reconcile the Discord message.
            console.error(`[CFPNotes] Could not record delivery of ${post.postId}:`, error);
        }
    }
}
