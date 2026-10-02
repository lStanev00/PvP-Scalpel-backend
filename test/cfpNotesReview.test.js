import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import CFPNotesPost from "../src/Models/CFPNotesPost.js";
import Service from "../src/Models/Services.js";
import { flushCFPNotesQueue, handleCFPNotesReviewButton } from "../src/bot/src/botHandlers/cfpNotesReview.js";
import { preparePNotesPayload } from "../src/services/Service-Helpers/CFPNotes/publishPNotes.js";
import sendClassTuning from "../src/bot/src/textBuilders/sendClassTuning.js";

function mockMethods(replacements) {
    const originals = replacements.map(([target, key, value]) => {
        const old = target[key]; target[key] = value; return [target, key, old];
    });
    return () => originals.forEach(([target, key, value]) => { target[key] = value; });
}
function interaction(action, roles = ["1318113244963012638"]) {
    const events = [];
    return { events, customId: `cfp:${action}:6391929`, channelId: "1554476424042123335",
        member: { roles }, message: { id: "review-1", delete: async () => events.push("delete") },
        reply: async value => events.push(["reply", value]),
        deferReply: async value => events.push(["defer", value]),
        editReply: async value => events.push(["edit", value]),
    };
}

test("review buttons enforce roles and claim one decision only", async () => {
    let calls = 0;
    const restore = mockMethods([[CFPNotesPost, "findOneAndUpdate", async filter => {
        calls++;
        assert.equal(filter.status, "review");
        return calls === 1 ? { postId: filter.postId } : null;
    }]]);
    try {
        const denied = interaction("accept", []);
        assert.equal(await handleCFPNotesReviewButton(denied), true);
        assert.equal(calls, 0);
        assert.match(denied.events[0][1].content, /Only the review team/);

        const accepted = interaction("accept");
        assert.equal(await handleCFPNotesReviewButton(accepted), true);
        assert.equal(calls, 1);
        assert.deepEqual(accepted.events.map(event => Array.isArray(event) ? event[0] : event),
            ["defer", "delete", "edit"]);
        assert.match(accepted.events[2][1], /Accepted/);

        const duplicate = interaction("dismiss");
        assert.equal(await handleCFPNotesReviewButton(duplicate), true);
        assert.equal(calls, 2);
        assert.ok(!duplicate.events.includes("delete"));
        assert.match(duplicate.events[1][1], /already decided/);
    } finally { restore(); }
});

test("dismiss button removes the review and records no public work", async () => {
    let update;
    const restore = mockMethods([[CFPNotesPost, "findOneAndUpdate", async (filter, change) => {
        update = change;
        return { postId: filter.postId };
    }]]);
    try {
        const dismissed = interaction("dismiss", ["1422201563555958885"]);
        await handleCFPNotesReviewButton(dismissed);
        assert.equal(update.$set.status, "dismissed");
        assert.ok(dismissed.events.includes("delete"));
        assert.match(dismissed.events.at(-1)[1], /No public announcement/);
    } finally { restore(); }
});

test("review queue and public link delivery recover from persisted status", async () => {
    const events = [];
    const post = { id: "mongo-1", postId: "6391929", title: "Hotfixes", url: "https://eu.forums.blizzard.com/en/wow/t/hotfixes/625785/40",
        createdAt: new Date(), scores: { retail: 0.9, pvp: 0.5 }, payload: { title: "Hotfixes", url: "https://eu.forums.blizzard.com/en/wow/t/hotfixes/625785/40" } };
    const reviewChannel = { isTextBased: () => true, send: async options => {
        events.push(["review", options]); return { id: "review-1" };
    } };
    const publicChannel = { isTextBased: () => true, send: async options => {
        events.push(["public", options]); return { id: "public-1" };
    } };
    const client = { user: { id: "bot" }, channels: { fetch: async id => id === "1554476424042123335" ? reviewChannel : publicChannel } };
    const restore = mockMethods([
        [CFPNotesPost, "find", query => ({ sort: async () => query.status === "review" ? [post] : query.status === "ready" ? [post] : [] })],
        [CFPNotesPost, "findOneAndUpdate", async () => post],
        [CFPNotesPost, "updateOne", async (filter, update) => { events.push(["update", filter, update]); return { modifiedCount: 1 }; }],
        [Service, "updateOne", async (filter, update) => { events.push(["service", filter, update]); }],
    ]);
    try {
        await flushCFPNotesQueue(client);
        assert.match(events[0][1].content, /Low confidence Blizzard post/);
        assert.match(events[0][1].content, /✅ Accept/);
        assert.equal(events[0][1].components[0].components.length, 2);
        const publicEvent = events.find(([type]) => type === "public");
        assert.equal(publicEvent[1].files, undefined);
        assert.match(publicEvent[1].content, /Hotfixes/);
        assert.equal(publicEvent[1].enforceNonce, true);
        assert.ok(events.some(([type, , update]) => type === "update" && update.$set?.status === "published"));
        assert.ok(events.some(([type]) => type === "service"));
    } finally { restore(); }
});

test("reconciles a public send after a bot restart without reposting", async () => {
    const events = [];
    const post = { id: "mongo-1", postId: "6391929", url: "https://eu.forums.blizzard.com/en/wow/t/hotfixes/625785/40" };
    const publicChannel = { isTextBased: () => true, messages: { fetch: async () => ({ find: callback => {
        const message = { id: "public-1", author: { id: "bot" }, content: post.url };
        return callback(message) ? message : undefined;
    } }) }, send: async () => { throw Error("duplicate send"); } };
    const client = { user: { id: "bot" }, channels: { fetch: async id => id === "1554476424042123335"
        ? { isTextBased: () => true } : publicChannel } };
    const restore = mockMethods([
        [CFPNotesPost, "find", query => ({ sort: async () => [], then: resolve => resolve(query.status === "sending" ? [post] : []) })],
        [CFPNotesPost, "updateOne", async (filter, update) => events.push(update)],
        [Service, "updateOne", async () => events.push("service")],
    ]);
    try {
        await flushCFPNotesQueue(client);
        assert.ok(events.some(update => update.$set?.status === "published"));
    } finally { restore(); }
});

test("accepted class analysis gets a card; system-only analysis stays a link", async () => {
    const post = { title: "PvP hotfixes", url: "https://example.com/post" };
    const render = async () => Buffer.from("PNG");
    const classPayload = await preparePNotesPayload(post, {
        analyze: async () => ({ changes: { classes: [[1, "buff"]], specs: [] }, systemUpdated: false }), render,
    });
    assert.ok(Buffer.isBuffer(classPayload.cardBuffer));
    const systemPayload = await preparePNotesPayload(post, {
        analyze: async () => ({ changes: { classes: [], specs: [] }, systemUpdated: true }), render,
    });
    assert.equal(systemPayload.cardBuffer, undefined);
    const sent = [];
    const client = { channels: { fetch: async () => ({ isTextBased: () => true, send: async options => { sent.push(options); return { id: "x" }; } }) } };
    await sendClassTuning(client, classPayload);
    await sendClassTuning(client, systemPayload);
    const binaryCard = mongoose.mongo.BSON.deserialize(mongoose.mongo.BSON.serialize({ cardBuffer: classPayload.cardBuffer }));
    await sendClassTuning(client, { ...classPayload, cardBuffer: binaryCard.cardBuffer });
    assert.equal(sent[0].files.length, 1);
    assert.equal(sent[1].files, undefined);
    assert.deepEqual(sent[2].files[0].attachment, Buffer.from("PNG"));
});
