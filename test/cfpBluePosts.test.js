import assert from "node:assert/strict";
import test from "node:test";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { getNewBluePosts } from "../src/services/Service-Helpers/CFPNotes/getLatesPNotes.js";
import getPostContent, { PostNotStaffError } from "../src/services/Service-Helpers/CFPNotes/getPostContent.js";
import { judgeBluePost } from "../src/services/Service-Helpers/CFPNotes/judgeBluePost.js";

const HOTFIX_ID = 6391929;
const makePost = (id, title = "World of Warcraft: Midnight Hotfixes - 24 September") => ({
    id, created_at: new Date(2026, 8, 25, 0, 0, id % 60).toISOString(),
    topic_title: title, url: `/t/hotfixes/625785/${id === HOTFIX_ID ? 40 : 1}`, post_type: 1,
});

test("staff feed pages by post ID and finds hotfix reply across pages", async () => {
    const first = Array.from({ length: 20 }, (_, i) => makePost(6391949 - i, "Retail news"));
    const second = [makePost(HOTFIX_ID), makePost(6391928, "WoW Classic update")];
    const seenUrls = [];
    const fetchImpl = async url => {
        seenUrls.push(String(url));
        return new Response(JSON.stringify({ posts: seenUrls.length === 1 ? first : second }));
    };
    const result = await getNewBluePosts({ cursor: "6391927", fetchImpl });
    assert.equal(seenUrls.length, 2);
    assert.match(seenUrls[1], /before_post_id=6391930/);
    assert.equal(result.newestId, "6391949");
    assert.equal(result.posts.length, 22);
    assert.equal(result.posts.find(post => post.id === HOTFIX_ID).url,
        "https://eu.forums.blizzard.com/en/wow/t/hotfixes/625785/40");
});

test("first scan respects 24-hour cutoff and later scan respects cursor", async () => {
    const page = [makePost(12), makePost(11), makePost(10)];
    page[2].created_at = "2026-09-20T00:00:00.000Z";
    const fetchImpl = async () => new Response(JSON.stringify({ posts: page }));
    const first = await getNewBluePosts({ since: new Date("2026-09-24T00:00:00Z"), fetchImpl });
    assert.deepEqual(first.posts.map(post => post.id), [11, 12]);
    const later = await getNewBluePosts({ cursor: "11", fetchImpl });
    assert.deepEqual(later.posts.map(post => post.id), [12]);
});

test("full post verification rejects player reply 42 and accepts staff reply 40", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async url => new Response(JSON.stringify({
        id: String(url).includes("6397255") ? 6397255 : HOTFIX_ID,
        staff: !String(url).includes("6397255"), post_type: 1,
        cooked: "<p>Player versus Player: Arena rules changed.</p>",
    }));
    try {
        const ref = { title: "Hotfixes", url: "https://eu.forums.blizzard.com/en/wow/t/hotfixes/625785/40" };
        await assert.rejects(getPostContent({ ...ref, id: 6397255 }), PostNotStaffError);
        assert.equal((await getPostContent({ ...ref, id: HOTFIX_ID })).id, HOTFIX_ID);
    } finally { globalThis.fetch = originalFetch; }
});

test("Jev probabilities route clear yes, clear no, and uncertain posts", async () => {
    const post = { title: "Hotfixes", html: "<p>PvP arena change.</p>" };
    for (const [retail, pvp, status] of [
        [0.85, 0.85, "approved"], [0.19, 0.95, "dismissed"], [0.9, 0.5, "review"],
    ]) {
        const client = { systemOne: async request => {
            assert.equal(request.questions.retail.type, "noul");
            assert.equal(request.questions.pvp.type, "noul");
            return { model: "jev-1.13.0", answers: { retail: { noul: retail }, pvp: { noul: pvp } } };
        } };
        assert.equal((await judgeBluePost(post, { client })).status, status);
    }
    await assert.rejects(judgeBluePost(post, { client: { systemOne: async () => { throw Error("offline"); } } }), /offline/);
});


test("Jev checks later chunks of a long blue post", async () => {
    let calls = 0;
    const client = { systemOne: async () => {
        calls++;
        return { model: "jev-1.13.0", answers: {
            retail: { noul: 0.95 }, pvp: { noul: calls === 1 ? 0.05 : 0.97 },
        } };
    } };
    const result = await judgeBluePost({ title: "Retail hotfixes", content: "a".repeat(10_001) }, { client });
    assert.equal(calls, 2);
    assert.equal(result.status, "approved");
});


test("official TypeSafe SDK sends the expected named Noul questions", async () => {
    let request;
    const client = new TypeSafeClient({ apiKey: "test-key", fetch: async (_url, options) => {
        request = JSON.parse(options.body);
        return new Response(JSON.stringify({ model: "jev-1.13.0", answers: {
            retail: { type: "noul", noul: 0.9 }, pvp: { type: "noul", noul: 0.95 },
        }, usage: { input_tokens: 100, output_tokens: 2 } }),
        { status: 200, headers: { "content-type": "application/json" } });
    } });
    const result = await judgeBluePost({ title: "Retail hotfix", content: "Arena change" }, { client });
    assert.equal(result.status, "approved");
    assert.equal(request.model, "jev-latest");
    assert.equal(request.questions.retail.type, "noul");
    assert.equal(request.questions.pvp.type, "noul");
});
