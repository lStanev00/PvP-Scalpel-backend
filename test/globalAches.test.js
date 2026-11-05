import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createContext, SourceTextModule, SyntheticModule } from "node:vm";

// Run with: node --experimental-vm-modules --test test/globalAches.test.js
const source = readFileSync(new URL("../src/caching/achievements/globalAches.js", import.meta.url), "utf8");
const maxAgeMs = 50 * 24 * 60 * 60 * 1000;
const href = "https://eu.api.blizzard.com/data/wow/achievement/1159?namespace=static-eu";
const definition = { name: "Just the Two of Us: 2200", description: "Earn a 2200 personal rating." };
const media = "https://example.com/achievement.jpg";
const clone = value => JSON.parse(JSON.stringify(value));

async function createHarness() {
    const state = { now: 1_800_000_000_000, cached: null, remote: definition, media, reads: [], fetches: [], mediaCalls: [], writes: [] };
    const context = createContext({
        URL,
        Date: class extends Date { static now() { return state.now; } },
        console: { warn() {} },
    });
    const dependencies = {
        "../../helpers/blizFetch-helpers/endpointFetchesBliz.js": {
            fetchBlizzard: async url => {
                state.fetches.push(url);
                if (state.fetchError) throw state.fetchError;
                return state.fetch ? await state.fetch() : state.remote;
            },
            getMedia: async (...args) => {
                state.mediaCalls.push(args);
                if (state.mediaError) throw state.mediaError;
                return state.getMedia ? await state.getMedia() : state.media;
            },
        },
        "../../helpers/redis/getterRedis.js": async (...args) => {
            state.reads.push(args);
            return state.cached;
        },
        "../../helpers/redis/setterRedis.js": async (...args) => {
            state.writes.push(clone(args));
            if (state.write) return await state.write();
            state.cached = args[1];
            return 1;
        },
    };
    const module = new SourceTextModule(source, { context });
    await module.link(specifier => {
        assert.ok(Object.hasOwn(dependencies, specifier), `Unexpected dependency: ${specifier}`);
        return new SyntheticModule(["default"], function () {
            this.setExport("default", dependencies[specifier]);
        }, { context });
    });
    await module.evaluate();
    return { state, cache: module.namespace.default };
}

function storedDefinition(now, changes = {}) {
    return { id: 1159, fetchedAt: now - 1000, href, ...definition, media, ...changes };
}

test("fresh achievement hits skip Blizzard and never extend the timestamp", async () => {
    const { cache, state } = await createHarness();
    state.cached = storedDefinition(state.now);
    assert.equal(await cache.getOne({ id: "1159", href }), state.cached);
    assert.deepEqual(state.reads, [[1159, "global_aches_non_rel"]]);
    assert.equal(state.fetches.length, 0);
    assert.equal(state.mediaCalls.length, 0);
    assert.equal(state.writes.length, 0);
});

test("a miss timestamps completed definition/media fetching and awaits a hash write without TTL", async () => {
    const { cache, state } = await createHarness();
    let releaseWrite;
    let writeStarted;
    const started = new Promise(resolve => { writeStarted = resolve; });
    state.getMedia = async () => { state.now += 100; return media; };
    state.write = () => new Promise(resolve => { releaseWrite = resolve; writeStarted(); });
    let returned = false;
    const request = cache.getOne({ id: 1159, href }).then(result => { returned = true; return result; });
    await started;
    assert.equal(returned, false);
    const expected = storedDefinition(state.now, { fetchedAt: state.now });
    assert.deepEqual(state.writes, [[1159, expected, "global_aches_non_rel"]]);
    assert.deepEqual(state.mediaCalls, [[definition, "media"]]);
    releaseWrite(1);
    assert.deepEqual(clone(await request), expected);
});

for (const [label, age, refresh] of [
    ["just under 50 days", maxAgeMs - 1, false],
    ["exactly 50 days", maxAgeMs, true],
    ["over 50 days", maxAgeMs + 1, true],
]) {
    test(`achievement age ${label}: ${refresh ? "refresh" : "reuse"}`, async () => {
        const { cache, state } = await createHarness();
        state.cached = storedDefinition(state.now, { fetchedAt: state.now - age });
        await cache.getOne({ id: 1159, href });
        assert.equal(state.fetches.length, Number(refresh));
        assert.equal(state.mediaCalls.length, Number(refresh));
        assert.equal(state.writes.length, Number(refresh));
    });
}

test("legacy entries and invalid timestamps, URLs, IDs, or payloads refresh", async () => {
    for (const changes of [
        { fetchedAt: undefined, href: undefined }, { fetchedAt: null }, { fetchedAt: "old" },
        { fetchedAt: NaN }, { fetchedAt: 0 }, { fetchedAt: 1_800_000_000_001 },
        { href: `${href}&locale=other` }, { id: 999 }, { media: null }, { description: undefined },
    ]) {
        const { cache, state } = await createHarness();
        state.cached = storedDefinition(state.now, changes);
        await cache.getOne({ id: 1159, href });
        assert.deepEqual(state.fetches, [href]);
        assert.deepEqual(clone(state.cached), storedDefinition(state.now, { fetchedAt: state.now }));
    }
});

test("concurrent achievement misses share both definition and media requests", async () => {
    const { cache, state } = await createHarness();
    let releaseFetch;
    let fetchStarted;
    const started = new Promise(resolve => { fetchStarted = resolve; });
    state.fetch = () => new Promise(resolve => { releaseFetch = resolve; fetchStarted(); });
    const first = cache.getOne({ id: 1159, href });
    const second = cache.getOne({ id: "1159", href });
    await started;
    assert.equal(state.fetches.length, 1);
    releaseFetch(definition);
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a, b);
    assert.equal(state.mediaCalls.length, 1);
    assert.equal(state.writes.length, 1);
    await cache.getOne({ id: 1159, href });
    assert.equal(state.reads.length, 2);
    assert.equal(state.fetches.length, 1);
});

test("definition and media failures preserve old entries and permit retry", async () => {
    for (const errorField of ["fetchError", "mediaError"]) {
        const { cache, state } = await createHarness();
        const old = storedDefinition(state.now, { fetchedAt: state.now - maxAgeMs });
        state.cached = old;
        state[errorField] = new Error("Blizzard unavailable");
        await assert.rejects(cache.getOne({ id: 1159, href }), /Blizzard unavailable/);
        assert.equal(state.cached, old);
        assert.equal(state.writes.length, 0);
        state[errorField] = null;
        await cache.getOne({ id: 1159, href });
        assert.equal(state.fetches.length, 2);
        assert.equal(state.cached.fetchedAt, state.now);
    }
});

test("empty and incomplete remote data never overwrite old entries", async () => {
    for (const changes of [{ remote: null }, { remote: undefined }, { media: null }, { remote: { name: "Incomplete" } }]) {
        const { cache, state } = await createHarness();
        const old = storedDefinition(state.now, { fetchedAt: state.now - maxAgeMs });
        Object.assign(state, changes, { cached: old });
        const result = await cache.getOne({ id: 1159, href });
        if (!state.remote) assert.equal(result, null);
        else assert.equal(result.media, state.media);
        assert.equal(state.cached, old);
        assert.equal(state.writes.length, 0);
    }
});

test("invalid getter inputs and cache metadata cause no Redis writes", async () => {
    const { cache, state } = await createHarness();
    for (const input of [undefined, { id: 0, href }, { id: 1.5, href }, { id: 1159, href: "invalid" }]) {
        assert.equal(await cache.getOne(input), undefined);
    }
    for (const changes of [{ fetchedAt: undefined }, { fetchedAt: 0 }, { href: "invalid" }]) {
        assert.equal(await cache.setOne(storedDefinition(state.now, changes)), undefined);
    }
    assert.equal(state.reads.length, 0);
    assert.equal(state.writes.length, 0);
});

test("a failed Redis write preserves the fetched return value", async () => {
    const { cache, state } = await createHarness();
    state.write = async () => null;
    const result = await cache.getOne({ id: 1159, href });
    assert.deepEqual(clone(result), storedDefinition(state.now, { fetchedAt: state.now }));
});
