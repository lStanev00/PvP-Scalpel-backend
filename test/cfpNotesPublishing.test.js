import assert from "node:assert/strict";
import test from "node:test";
import { MessageFlags } from "discord.js";
import publishPNotes from "../src/services/Service-Helpers/CFPNotes/publishPNotes.js";
import { analyzePNotesContext, buildPNotesAIContext, PNotesValidationError } from "../src/services/Service-Helpers/CFPNotes/analyzePNotes.js";
import sendClassTuning from "../src/bot/src/textBuilders/sendClassTuning.js";

const post = { id: 6350810, title: "Class Tuning – 1 September", url: "https://eu.forums.blizzard.com/en/wow/t/627043/31" };
const analysis = { changes: { classes: [[7,"nerf|bug_fix"]], specs: [[262,"nerf"]] }, systemUpdated: false };
const image = Buffer.from("mock PNG");

function harness({ rejected = false, renderable = true, renderFails = false, dmFails = false } = {}) {
    const publicMessages = [], privateMessages = [], events = [], logs = [];
    const client = {
        channels: { fetch: async id => {
            assert.equal(id, "1548298695022215188");
            return { isTextBased: () => true, send: async message => publicMessages.push(message) };
        } },
        users: { fetch: async id => {
            assert.equal(id, "348181106878840832");
            return { send: async message => {
                if (dmFails) throw new Error("DMs closed");
                privateMessages.push(message);
            } };
        } },
    };
    const dependencies = {
        analyze: async () => {
            if (rejected) throw new PNotesValidationError(["Unsupported target: Frost Death Knight"], renderable ? analysis : null);
            return analysis;
        },
        render: async (received, source) => {
            assert.deepEqual(received, analysis);
            assert.equal(source, post);
            events.push("render");
            if (renderFails) throw new Error("missing database target");
            return image;
        },
        publish: async (channel, message) => {
            assert.equal(channel, "annoDiscord:newClassChanges");
            events.push("publish");
            // Exercise the real Buffer -> JSON -> Buffer Redis boundary.
            await sendClassTuning(client, JSON.parse(message), {error: (...args) => logs.push(args)});
        },
        cache: async (key, id) => {
            assert.equal(key, "CFPNotes");
            assert.equal(id, post.id);
            events.push("cache");
        },
    };
    return { dependencies, publicMessages, privateMessages, events, logs };
}

test("valid analysis sends the normal linked image and caches after publishing", async () => {
    const h = harness();
    await publishPNotes(post, h.dependencies);
    assert.deepEqual(h.events, ["render","publish","cache"]);
    assert.equal(h.privateMessages.length, 0);
    const message = h.publicMessages[0];
    assert.equal(message.content, `### [${post.title}](${post.url})`);
    assert.equal(message.flags, MessageFlags.SuppressEmbeds);
    assert.deepEqual(message.files[0].attachment, image);
    assert.equal(message.files[0].name, "class-tuning.png");
});

test("rejected analysis posts only a link publicly and sends an UNVERIFIED diagnostic image privately", async () => {
    const h = harness({rejected:true});
    await publishPNotes(post, h.dependencies);
    assert.deepEqual(h.events, ["render","publish","cache"]);
    assert.equal(h.publicMessages.length, 1);
    assert.equal(h.publicMessages[0].files, undefined);
    assert.equal(h.publicMessages[0].flags, MessageFlags.SuppressEmbeds);
    assert.equal(h.publicMessages[0].content, `### [${post.title}](${post.url})`);
    const diagnostic = h.privateMessages[0];
    assert.ok(diagnostic.content.includes(post.url));
    assert.match(diagnostic.content, /UNVERIFIED.*\n• Unsupported target/s);
    assert.equal(diagnostic.files[0].name, "UNVERIFIED-class-tuning.png");
    assert.deepEqual(diagnostic.files[0].attachment, image);
    assert.match(diagnostic.files[1].attachment.toString(), /Unsupported target/);
});

for (const options of [{renderable:false}, {renderFails:true}]) {
    test(`unrenderable rejection still sends explanations and caches fallback: ${JSON.stringify(options)}`, async () => {
        const h = harness({rejected:true, ...options});
        await publishPNotes(post, h.dependencies);
        assert.equal(h.publicMessages[0].files, undefined);
        assert.equal(h.privateMessages[0].files.length, 1);
        assert.equal(h.privateMessages[0].files[0].name, "validation-errors.txt");
        assert.equal(h.events.at(-1), "cache");
        if (!options.renderable && !options.renderFails) assert.ok(!h.events.includes("render"));
    });
}

test("closed diagnostic DMs are logged separately and do not block main-channel link or caching", async () => {
    const h = harness({rejected:true, dmFails:true});
    await publishPNotes(post, h.dependencies);
    assert.equal(h.publicMessages.length, 1);
    assert.equal(h.privateMessages.length, 0);
    assert.equal(h.events.at(-1), "cache");
    assert.match(h.logs[0][0], /Failed to DM/);
});

test("a Redis publishing failure does not mark the post as handled", async () => {
    const h = harness({rejected:true});
    h.dependencies.publish = async () => { throw new Error("Redis disconnected"); };
    await assert.rejects(publishPNotes(post, h.dependencies), /Redis disconnected/);
    assert.ok(!h.events.includes("cache"));
});

test("transport failures remain retryable, not misreported as invalid analysis", async () => {
    const h = harness();
    h.dependencies.analyze = async () => { throw new Error("Ollama unavailable"); };
    await assert.rejects(publishPNotes(post, h.dependencies), /Ollama unavailable/);
    assert.deepEqual(h.events, []);
});

test("malformed Ollama results take the unrenderable fallback end to end", async () => {
    const context = buildPNotesAIContext({title:post.title, content:"Shaman\n• Damage increased by 5%."},
        [{_id:7,name:"Shaman"}], [{_id:262,name:"Elemental",relClass:7}]);
    for (const response of ["not JSON", "{}", JSON.stringify({message:{content:"not JSON"}}),
        JSON.stringify({message:{content:JSON.stringify({...analysis, unexpected:true})}})]) {
        const h = harness();
        h.dependencies.analyze = () => analyzePNotesContext(context, {fetchImpl:async () => new Response(response)});
        await publishPNotes(post, h.dependencies);
        assert.deepEqual(h.events, ["publish","cache"]);
        assert.equal(h.publicMessages[0].files, undefined);
        assert.equal(h.privateMessages[0].files[0].name, "validation-errors.txt");
    }
});
