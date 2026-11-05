import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createContext, SourceTextModule, SyntheticModule } from "node:vm";

// Run with: node --experimental-vm-modules --test test/globalTitles.test.js
const cacheSource = readFileSync(new URL("../src/caching/titles/globalTitles.js", import.meta.url), "utf8");
const endpointSource = readFileSync(new URL("../src/helpers/blizFetch-helpers/endpointFetchesBliz.js", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const leaderboardSource = readFileSync(new URL("../src/services/globalLDBS.js", import.meta.url), "utf8");
const maxAgeMs = 50 * 24 * 60 * 60 * 1000;
const href = "https://eu.api.blizzard.com/data/wow/pvp-tier/6?namespace=dynamic-eu";
const title = { name: "Rival", media: "https://example.com/rival.jpg" };
const clone = value => JSON.parse(JSON.stringify(value));

async function createHarness() {
    const state = { now: 1_800_000_000_000, cached: null, remote: title, reads: [], writes: [], fetches: [] };
    const context = createContext({
        URL,
        Date: class extends Date { static now() { return state.now; } },
        console: { warn() {} },
    });
    const dependencies = {
        "../../helpers/blizFetch-helpers/endpointFetchesBliz.js": {
            getPvPTitle: async url => {
                state.fetches.push(url);
                if (state.fetchError) throw state.fetchError;
                return state.fetch ? await state.fetch() : state.remote;
            },
        },
        "../../helpers/redis/getterRedis.js": async (...args) => {
            state.reads.push(args);
            return state.cached;
        },
        "../../helpers/redis/setterRedis.js": async (...args) => {
            state.writes.push(clone(args));
            if (state.write) return await state.write(args[1]);
            state.cached = args[1];
            return 1;
        },
    };
    const module = new SourceTextModule(cacheSource, { context });
    await module.link(specifier => {
        assert.ok(Object.hasOwn(dependencies, specifier), `Unexpected dependency: ${specifier}`);
        return new SyntheticModule(["default"], function () {
            this.setExport("default", dependencies[specifier]);
        }, { context });
    });
    await module.evaluate();
    return { state, cache: module.namespace.default };
}

function storedTitle(now, overrides = {}) {
    return { id: 6, fetchedAt: now - 1000, href, ...title, ...overrides };
}

test("fresh cache hits do not fetch, write, or renew fetchedAt", async () => {
    const { cache, state } = await createHarness();
    state.cached = storedTitle(state.now);
    const result = await cache.getOne({ id: "6", href });
    assert.equal(result, state.cached);
    assert.deepEqual(state.reads, [[6, "global_titles_non_rel"]]);
    assert.equal(state.fetches.length, 0);
    assert.equal(state.writes.length, 0);
});

test("cache misses await a hash write before returning, without Redis TTL", async () => {
    const { cache, state } = await createHarness();
    let releaseWrite;
    let writeStarted;
    const started = new Promise(resolve => { writeStarted = resolve; });
    state.fetch = async () => { state.now += 100; return title; };
    state.write = () => new Promise(resolve => {
        releaseWrite = resolve;
        writeStarted();
    });
    let returned = false;
    const request = cache.getOne({ id: 6, href }).then(result => { returned = true; return result; });
    await started;
    assert.equal(returned, false);
    const expected = storedTitle(state.now, { fetchedAt: state.now });
    assert.deepEqual(state.writes, [[6, expected, "global_titles_non_rel"]]);
    releaseWrite(1);
    assert.deepEqual(clone(await request), expected);
});

for (const [label, age, refresh] of [
    ["just under 50 days", maxAgeMs - 1, false],
    ["exactly 50 days", maxAgeMs, true],
    ["over 50 days", maxAgeMs + 1, true],
]) {
    test(`${label}: ${refresh ? "refresh" : "reuse"} the entry`, async () => {
        const { cache, state } = await createHarness();
        state.cached = storedTitle(state.now, { fetchedAt: state.now - age });
        await cache.getOne({ id: 6, href });
        assert.equal(state.fetches.length, Number(refresh));
        assert.equal(state.writes.length, Number(refresh));
    });
}

test("missing, invalid, and future timestamps trigger refresh", async () => {
    for (const fetchedAt of [undefined, null, "yesterday", NaN, 0, 1_800_000_000_001]) {
        const { cache, state } = await createHarness();
        state.cached = storedTitle(state.now, { fetchedAt });
        await cache.getOne({ id: 6, href });
        assert.equal(state.fetches.length, 1);
        assert.equal(state.cached.fetchedAt, state.now);
    }
});

test("different URLs and invalid cached payloads trigger refresh", async () => {
    for (const changes of [{ href: `${href}&locale=other` }, { media: null }, { name: "" }, { id: 7 }]) {
        const { cache, state } = await createHarness();
        state.cached = storedTitle(state.now, changes);
        await cache.getOne({ id: 6, href });
        assert.deepEqual(state.fetches, [href]);
        assert.deepEqual(clone(state.cached), storedTitle(state.now, { fetchedAt: state.now }));
    }
});

test("concurrent lookups share a request, then subsequent reads check Redis again", async () => {
    const { cache, state } = await createHarness();
    let releaseFetch;
    let fetchStarted;
    const started = new Promise(resolve => { fetchStarted = resolve; });
    state.fetch = () => new Promise(resolve => {
        releaseFetch = resolve;
        fetchStarted();
    });
    const first = cache.getOne({ id: 6, href });
    const second = cache.getOne({ id: "6", href });
    await started;
    assert.equal(state.fetches.length, 1);
    releaseFetch(title);
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a, b);
    assert.equal(state.writes.length, 1);
    await cache.getOne({ id: 6, href });
    assert.equal(state.reads.length, 2);
    assert.equal(state.fetches.length, 1);
});

test("rejected fetches preserve old entries and allow a later retry", async () => {
    const { cache, state } = await createHarness();
    const old = storedTitle(state.now, { fetchedAt: state.now - maxAgeMs });
    state.cached = old;
    state.fetchError = new Error("Blizzard unavailable");
    await assert.rejects(cache.getOne({ id: 6, href }), /Blizzard unavailable/);
    assert.equal(state.cached, old);
    assert.equal(state.writes.length, 0);
    state.fetchError = null;
    await cache.getOne({ id: 6, href });
    assert.equal(state.fetches.length, 2);
    assert.equal(state.cached.fetchedAt, state.now);
});

test("unavailable and partial results are not cached or used to renew old entries", async () => {
    for (const remote of [undefined, null, { name: "Rival", media: null }, { name: "Rival", media: undefined }]) {
        const { cache, state } = await createHarness();
        const old = storedTitle(state.now, { fetchedAt: state.now - maxAgeMs });
        state.cached = old;
        state.remote = remote;
        const result = await cache.getOne({ id: 6, href });
        assert.equal(result?.media, remote?.media);
        assert.equal(state.cached, old);
        assert.equal(state.writes.length, 0);
    }
});

test("invalid getter inputs and store documents do not reach Redis", async () => {
    const { cache, state } = await createHarness();
    for (const input of [undefined, { id: 0, href }, { id: 1.5, href }, { id: 6, href: "not-a-url" }]) {
        assert.equal(await cache.getOne(input), undefined);
    }
    for (const changes of [{ id: -1 }, { href: "invalid" }, { name: "" }, { media: "http://example.com/icon" }, { fetchedAt: undefined }]) {
        assert.equal(await cache.setOne(storedTitle(state.now, changes)), undefined);
    }
    assert.equal(state.reads.length, 0);
    assert.equal(state.writes.length, 0);
});

test("a Redis write returning null does not discard a valid fetched title", async () => {
    const { cache, state } = await createHarness();
    state.write = async () => null;
    assert.deepEqual(clone(await cache.getOne({ id: 6, href })), storedTitle(state.now, { fetchedAt: state.now }));
});

function loadRatingHelper(cache) {
    const start = endpointSource.indexOf("    getRating: async function");
    const end = endpointSource.indexOf("    /**", start);
    return new Function("dependencies", `
        const { global_titles_non_rel, extRetChar, findCharFromDatabase, createDefaultRatingResult } = dependencies;
        const helpFetch = { ${endpointSource.slice(start, end)} };
        return helpFetch;
    `)({
        global_titles_non_rel: cache,
        extRetChar: async () => undefined,
        findCharFromDatabase: { byPvPUrl: async () => ({ legacyRetrieved: true }) },
        createDefaultRatingResult: () => ({ "2v2": { currentSeason: {} } }),
    });
}

for (const currentSeason of [true, false]) {
    test(`getRating ${currentSeason ? "uses cached titles without metadata" : "skips past-season title lookups"}`, async () => {
        const requests = [];
        const cachedTitle = storedTitle(1_800_000_000_000);
        const helper = loadRatingHelper({ getOne: async input => { requests.push(input); return cachedTitle; } });
        const summaryUrl = "https://eu.api.blizzard.com/profile/wow/character/realm/example/pvp-summary";
        helper.fetchBlizzard = async url => url === summaryUrl ? {
            _links: { self: { href: summaryUrl } },
            character: { name: "Example", realm: { slug: "realm" } },
            brackets: [{ href: "https://eu.api.blizzard.com/pvp-bracket/2v2?namespace=profile-eu" }],
        } : { season: { id: currentSeason ? 100 : 99 }, bracket: { type: "ARENA_2v2" }, tier: { id: 6, key: { href } }, rating: 2100 };
        const result = await helper.getRating(summaryUrl, 100);
        assert.equal(result["2v2"].currentSeason.rating, currentSeason ? 2100 : 0);
        assert.deepEqual(requests, currentSeason ? [{ id: 6, href }] : []);
        assert.deepEqual(result["2v2"].currentSeason.title, currentSeason ? title : undefined);
    });
}

test("leaderboard helper uses the shared title getter and keeps cache metadata out of ratings", async () => {
    const requests = [];
    const ratingUpdates = new Map();
    const charsToUpdate = new Map();
    const handle = new Function("dependencies", `
        const { Realm, server, global_titles_non_rel, dataGuard, ratingUpdates, charsToUpdate } = dependencies;
        ${leaderboardSource.slice(leaderboardSource.indexOf("async function handleLooseBracket"))}
        return handleLooseBracket;
    `)({
        Realm: { findById: () => ({ select: () => ({ lean: async () => ({ name: { en_GB: "Realm" } }) }) }) },
        server: "eu",
        global_titles_non_rel: { getOne: async input => { requests.push(input); return storedTitle(1_800_000_000_000); } },
        dataGuard: async () => 200,
        ratingUpdates,
        charsToUpdate,
    });
    const charDoc = { blizID: 1, rating: new Map([
        ["2v2", { currentSeason: { weeklyMatchStatistics: { played: 2 } }, record: 2500 }],
        ["3v3", { currentSeason: { rating: 2800 }, record: 3000 }],
    ]) };
    const entry = ["2v2", 2100, { played: 1, won: 1, lost: 0 }, { id: 6, key: { href } }, { id: 1, name: "Example", realm: { id: 554, slug: "realm" } }];
    await handle(charDoc, entry);
    assert.deepEqual(requests, [{ id: 6, href }]);
    assert.deepEqual(charDoc.rating.get("2v2").currentSeason.title, title);
    assert.deepEqual(Object.keys(ratingUpdates.get(1).$set).sort(), [
        "rating.2v2.currentSeason.rating",
        "rating.2v2.currentSeason.seasonMatchStatistics",
        "rating.2v2.currentSeason.title",
    ]);
    assert.deepEqual(ratingUpdates.get(1).$max, { "rating.2v2.record": 2500 });
    await handle(charDoc, [entry[0], 2800, ...entry.slice(2)]);
    await handle(charDoc, [entry[0], 2000, ...entry.slice(2)]);
    assert.equal(ratingUpdates.get(1).$max["rating.2v2.record"], 2800);
    assert.equal(charDoc.rating.get("2v2").record, 2800);
    assert.equal(ratingUpdates.get(1).$set["rating.2v2.currentSeason.rating"], 2000);
    assert.equal(charsToUpdate.get(1), charDoc);
});

test("changed modules parse without connecting to services", () => {
    for (const source of [cacheSource, endpointSource, leaderboardSource]) new SourceTextModule(source);
});
