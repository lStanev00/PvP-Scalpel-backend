import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { createContext, SourceTextModule, SyntheticModule } from "node:vm";

// Run with: node --experimental-vm-modules --test test/blizFetchRetry.test.js
const endpointSource = readFileSync(new URL("../src/helpers/blizFetch-helpers/endpointFetchesBliz.js", import.meta.url), "utf8");
const minimalSource = readFileSync(new URL("../src/helpers/blizFetch.js", import.meta.url), "utf8");
const tokenSource = readFileSync(new URL("../src/caching/blizTokenCache/tokenCache.js", import.meta.url), "utf8");
const gateSource = readFileSync(new URL("../src/helpers/blizFetch-helpers/blizzardRequestGate.js", import.meta.url), "utf8");
const requestMethod = endpointSource.slice(endpointSource.indexOf("    fetchBlizzard: async function"), endpointSource.indexOf("    getCharMedia:"));
const url = "https://eu.api.blizzard.com/profile/wow/character/realm/example?namespace=profile-eu";

function createClock() {
    const clock = { now: 1000, timers: new Map(), signals: [], delays: [] };
    clock.setTimeout = (fn, ms) => {
        const timer = { fn, due: clock.now + ms, unref() {} };
        clock.timers.set(timer, timer);
        return timer;
    };
    clock.clearTimeout = timer => clock.timers.delete(timer);
    clock.advance = async ms => {
        const target = clock.now + ms;
        while (true) {
            const timer = [...clock.timers.values()].sort((a, b) => a.due - b.due)[0];
            if (!timer || timer.due > target) break;
            clock.now = timer.due;
            clock.timers.delete(timer);
            timer.fn();
            await setImmediate();
        }
        clock.now = target;
        await setImmediate();
    };
    clock.AbortSignal = {
        timeout(ms) {
            assert.equal(ms, 20_000);
            const controller = new AbortController();
            const timer = clock.setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), ms);
            timer.abortDeadline = true;
            clock.signals.push(controller.signal);
            return controller.signal;
        },
        any: signals => AbortSignal.any(signals),
    };
    clock.delay = (ms, value, { signal } = {}) => {
        clock.delays.push(ms);
        return new Promise((resolve, reject) => {
            signal?.throwIfAborted();
            const onAbort = () => {
                clock.clearTimeout(timer);
                reject(signal.reason);
            };
            const timer = clock.setTimeout(() => {
                signal?.removeEventListener("abort", onAbort);
                resolve(value);
            }, ms);
            signal?.addEventListener("abort", onAbort, { once: true });
        });
    };
    return clock;
}

function makeContext(clock, globals = {}) {
    const logs = { info: [], warn: [], error: [], log: [] };
    const context = createContext({
        Date: class extends Date { static now() { return clock.now; } },
        AbortSignal: clock.AbortSignal,
        AbortController,
        setTimeout: clock.setTimeout,
        clearTimeout: clock.clearTimeout,
        console: Object.fromEntries(Object.keys(logs).map(level => [level, (...args) => logs[level].push(args)])),
        ...globals,
    });
    return { context, logs };
}

async function loadModule(source, context, dependencies = {}) {
    const module = new SourceTextModule(source, { context });
    await module.link(specifier => {
        const exports = dependencies[specifier];
        assert.ok(exports, `Unexpected dependency: ${specifier}`);
        return new SyntheticModule(Object.keys(exports), function () {
            for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
        }, { context });
    });
    await module.evaluate();
    return module.namespace;
}

async function finish(promise, clock) {
    let done = false, value, failure;
    promise.then(result => { done = true; value = result; }, error => { done = true; failure = error; });
    for (let step = 0; !done && step < 100; step++) {
        await setImmediate();
        if (done) break;
        const next = Math.min(...[...clock.timers.values()].map(timer => timer.due));
        assert.ok(Number.isFinite(next), "Operation stalled without a deadline");
        await clock.advance(next - clock.now);
    }
    assert.ok(done, "Operation exceeded the mocked time budget");
    if (failure) throw failure;
    return value;
}

function untilAborted(signal) {
    return new Promise((resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
}

async function createRequestHarness(fetchImpl, save = async () => {}) {
    const clock = createClock();
    const calls = [], errorDocs = [], tokenSignals = [], starts = [];
    const { context, logs } = makeContext(clock, {
        fetch: async (...args) => { calls.push(args); starts.push(clock.now); return await fetchImpl(...args); },
        retryDelay: clock.delay,
        getAccessToken: async signal => { tokenSignals.push(signal); return "test-token"; },
        BlizAPIError: class {
            constructor(doc) { errorDocs.push(doc); }
            save() { return save(); }
        },
    });
    const { gate, redis } = await createGateHarness(clock, context);
    Object.assign(context, gate);
    const module = await loadModule(`export default { ${requestMethod} };`, context);
    return { clock, calls, logs, errorDocs, tokenSignals, starts, redis, request: module.default.fetchBlizzard.bind(module.default) };
}

async function createGateHarness(clock = createClock(), context = makeContext(clock).context, shared = {}) {
    const state = shared;
    const redis = {
        isReady: true,
        withAbortSignal(signal) { signal.throwIfAborted(); return this; },
        async eval(script, { keys, arguments: [action, duration] }) {
            assert.deepEqual([...keys], ["blizzard:request_gate"]);
            assert.match(script, /redis.call\('TIME'\)/);
            if (state.eval) return state.eval();
            duration = Number(duration);
            if (action === "cooldown") {
                state.cooldown = Math.max(state.cooldown ?? 0, clock.now + duration);
                return state.cooldown - clock.now;
            }
            const wait = Math.max(state.cooldown ?? 0, state.next ?? 0) - clock.now;
            if (wait > 0) return wait;
            state.next = clock.now + duration;
            return 0;
        },
    };
    context.process = { env: {} };
    const gate = await loadModule(gateSource, context, {
        "node:timers/promises": { setTimeout: clock.delay },
        "../redis/connectRedis.js": { redisCache: redis },
    });
    return { clock, gate, state, redis };
}

const response = (text, status = 200, retryAfter = null) => ({
    status, text: async () => text, headers: { get: () => retryAfter },
});

test("success preserves options and returns parsed JSON", async () => {
    const h = await createRequestHarness(async () => response('{"id":123}'));
    const result = await h.request(url, { method: "POST", body: "payload", headers: { "X-Test": "kept" } });
    assert.equal(result.id, 123);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0][0], `${url}&locale=en_GB`);
    assert.equal(h.calls[0][1].method, "POST");
    assert.equal(h.calls[0][1].body, "payload");
    assert.equal(h.calls[0][1].headers["X-Test"], "kept");
    assert.equal(h.calls[0][1].headers.Authorization, "Bearer test-token");
    assert.deepEqual(h.clock.delays, []);
    assert.equal(h.errorDocs.length, 0);
});

test("parsed API errors other than rate limits are returned without retries", async () => {
    for (const status of [400, 401, 403, 404]) {
        const h = await createRequestHarness(async () => response(JSON.stringify({ code: status, detail: "Unavailable" }), status));
        assert.equal((await h.request(url)).code, status);
        assert.equal(h.calls.length, 1);
        assert.equal(h.clock.delays.length, 0);
    }
});

for (const body of ["", "<html>Too many requests</html>", '{"code":429}']) {
    test(`HTTP 429 retries regardless of body ${JSON.stringify(body)}`, async () => {
        const h = await createRequestHarness(async () => response(body, 429));
        assert.equal(await finish(h.request(url), h.clock), null);
        assert.equal(h.calls.length, 5);
        assert.deepEqual(h.starts, [1000, 6000, 16000, 36000, 76000]);
        assert.equal(h.clock.now, 76000, "No wait after the last attempt");
        assert.match(h.logs.warn[0][0], /status=429.*shared cooldown 5000ms/);
        assert.ok(h.errorDocs.every(doc => doc.status === 429));
    });
}

test("429 respects Retry-After seconds and HTTP dates before a successful retry", async () => {
    for (const header of ["7", new Date(8000).toUTCString()]) {
        let calls = 0;
        const h = await createRequestHarness(async () => ++calls === 1
            ? response("", 429, header) : response('{"id":123}'));
        assert.equal((await finish(h.request(url), h.clock)).id, 123);
        assert.deepEqual(h.starts, [1000, 8000]);
    }
});

test("429 does not wait for or parse its response body", async () => {
    let calls = 0, cancelled = 0;
    const h = await createRequestHarness(async () => ++calls === 1 ? {
        status: 429,
        headers: { get: () => "1" },
        body: { cancel: async () => { cancelled++; } },
        text: () => { throw new Error("429 body must not be read"); },
    } : response("{}"));
    await finish(h.request(url), h.clock);
    assert.equal(cancelled, 1);
    assert.deepEqual(h.starts, [1000, 2000]);
});

test("request starts are spaced across concurrent fetches", async () => {
    const h = await createRequestHarness(async () => response("{}"));
    await finish(Promise.all(Array.from({ length: 8 }, () => h.request(url))), h.clock);
    assert.deepEqual(h.starts, Array.from({ length: 8 }, (_, i) => 1000 + 125 * i));
});

test("independent processes share pacing and observe extended cooldowns", async () => {
    const clock = createClock();
    const a = await createGateHarness(clock);
    const b = await createGateHarness(clock, undefined, a.state);
    await a.gate.waitForBlizzardSlot();
    const starts = [];
    const pending = b.gate.waitForBlizzardSlot().then(() => starts.push(clock.now));
    await setImmediate();
    await a.gate.backOffBlizzard("2", 1);
    await clock.advance(125);
    assert.deepEqual(starts, []);
    await a.gate.backOffBlizzard("3", 1);
    await finish(pending, clock);
    assert.deepEqual(starts, [4125]);
});

test("a shorter cooldown cannot overwrite a longer cooldown", async () => {
    const h = await createGateHarness();
    await h.gate.backOffBlizzard("60", 1);
    await h.gate.backOffBlizzard("1", 1);
    assert.equal(h.state.cooldown, 61000);
});

test("missing, invalid and past Retry-After values use capped exponential cooldowns", async () => {
    for (const header of [null, "invalid", new Date(0).toUTCString()]) {
        const h = await createGateHarness();
        assert.equal(await h.gate.backOffBlizzard(header, 1), 5000);
        assert.equal(await h.gate.backOffBlizzard(header, 5), 60000);
    }
});

test("caller cancellation during shared cooldown stops retries", async () => {
    const h = await createRequestHarness(async () => response("", 429, "60"));
    const controller = new AbortController();
    const request = h.request(url, { signal: controller.signal });
    const rejected = assert.rejects(request, error => error.name === "AbortError");
    await setImmediate();
    controller.abort();
    await rejected;
    assert.equal(h.calls.length, 1);
});

test("Redis gate failures never send unpaced HTTP requests", async () => {
    const h = await createRequestHarness(async () => response("{}"));
    h.redis.isReady = false;
    assert.equal(await finish(h.request(url), h.clock), null);
    assert.equal(h.calls.length, 0);
    assert.equal(h.errorDocs.length, 5);
});

test("a stalled Redis gate reply has a five-second deadline", async () => {
    const h = await createGateHarness();
    h.state.eval = () => new Promise(() => {});
    await assert.rejects(finish(h.gate.waitForBlizzardSlot(), h.clock), /gate timed out/);
    assert.equal(h.clock.now, 6000);
    assert.equal(h.clock.timers.size, 0);
});

for (const text of ["Downstream Error", '"Downstream Error"', "not JSON", "null"]) {
    test(`invalid response ${text} consumes exactly five attempts`, async () => {
        const h = await createRequestHarness(async () => response(text));
        assert.equal(await finish(h.request(url), h.clock), null);
        assert.equal(h.calls.length, 5);
        assert.deepEqual(h.clock.delays, [1000, 1000, 1000, 1000]);
        assert.equal(h.errorDocs.length, 5);
        assert.equal(new Set(h.calls.map(([, options]) => options.signal)).size, 5);
        assert.match(h.logs.warn[0][0], /attempt=1\/5 status=200 failed after/);
    });
}

for (const stage of ["headers", "body"]) {
    test(`stalled ${stage} time out and exhaust within 104 seconds`, async () => {
        const h = await createRequestHarness(async (_, { signal }) => stage === "headers"
            ? await untilAborted(signal)
            : { status: 200, text: () => untilAborted(signal) });
        assert.equal(await finish(h.request(url), h.clock), null);
        assert.equal(h.calls.length, 5);
        assert.equal(h.clock.now - 1000, 104_000);
        assert.equal(h.clock.delays.length, 4);
        assert.equal(h.errorDocs[0].status, stage === "headers" ? 0 : 200);
        assert.match(h.logs.warn[0][0], /20000ms: Request timed out/);
    });
}

test("network failures have safe status logging even without a response", async () => {
    const h = await createRequestHarness(async () => { throw new Error("network unavailable"); });
    assert.equal(await finish(h.request(url), h.clock), null);
    assert.equal(h.calls.length, 5);
    assert.ok(h.errorDocs.every(doc => doc.status === 0 && doc.body === "network unavailable"));
});

test("a later successful attempt returns its result without further delays", async () => {
    let calls = 0;
    const h = await createRequestHarness(async () => response(++calls === 1 ? "Downstream Error" : '{"id":123}'));
    assert.equal((await finish(h.request(url), h.clock)).id, 123);
    assert.equal(h.calls.length, 2);
    assert.deepEqual(h.clock.delays, [1000]);
});

test("stalled, rejected, and synchronously failed error-log writes cannot block retries", async () => {
    for (const save of [() => new Promise(() => {}), async () => { throw new Error("database unavailable"); }, () => { throw new Error("logging failed"); }]) {
        const h = await createRequestHarness(async () => response("invalid"), save);
        assert.equal(await finish(h.request(url), h.clock), null);
        assert.equal(h.calls.length, 5);
    }
});

test("a pre-aborted caller never acquires a token or sends a request", async () => {
    const h = await createRequestHarness(async () => response("{}"));
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(h.request(url, { signal: controller.signal }), error => error.name === "AbortError");
    assert.equal(h.calls.length, 0);
    assert.equal(h.tokenSignals.length, 0);
});

for (const stage of ["headers", "body", "backoff"]) {
    test(`caller cancellation during ${stage} stops immediately without more attempts`, async () => {
        const h = await createRequestHarness(async (_, { signal }) => stage === "backoff" ? response("invalid")
            : stage === "headers" ? untilAborted(signal) : { status: 200, text: () => untilAborted(signal) });
        const controller = new AbortController();
        const request = h.request(url, { signal: controller.signal });
        const rejected = assert.rejects(request, error => error.name === "AbortError");
        await setImmediate();
        assert.equal(h.calls.length, 1);
        assert.equal(h.tokenSignals[0], controller.signal);
        controller.abort();
        await rejected;
        assert.equal(h.clock.now, 1000);
        assert.equal(h.calls.length, 1);
        assert.equal(h.errorDocs.length, stage === "backoff" ? 1 : 0);
    });
}

async function createTokenHarness(fetchImpl, cached = false) {
    const clock = createClock();
    const calls = [], writes = [];
    const { context, logs } = makeContext(clock, {
        Buffer,
        process: { env: { CLIENT_ID: "test-client", CLIENT_SECRET: "test-secret" } },
        fetch: async (...args) => { calls.push(args); return await fetchImpl(...args); },
    });
    const module = await loadModule(tokenSource, context, {
        dotenv: { configDotenv() {} },
        "../../helpers/redis/getterRedis.js": { default: async key => cached ? key === "cachedToken" ? "cached-token" : clock.now + 60_000 : null },
        "../../helpers/redis/setterRedis.js": { default: async (...args) => { writes.push(args); } },
    });
    return { clock, calls, writes, logs, getToken: module.default };
}

for (const stage of ["headers", "body"]) {
    test(`OAuth ${stage} stalls abort after 20 seconds without caching a token`, async () => {
        const h = await createTokenHarness(async (_, { signal }) => stage === "headers"
            ? untilAborted(signal) : { ok: true, json: () => untilAborted(signal) });
        await assert.rejects(finish(h.getToken(), h.clock), error => error.name === "TimeoutError");
        assert.equal(h.clock.now - 1000, 20_000);
        assert.equal(h.calls.length, 1);
        assert.equal(h.writes.length, 0);
    });
}

test("cached OAuth tokens avoid HTTP and successful fresh tokens are cached", async () => {
    const cached = await createTokenHarness(async () => { throw new Error("unexpected HTTP"); }, true);
    assert.equal(await cached.getToken(), "cached-token");
    assert.equal(cached.calls.length, 0);
    const h = await createTokenHarness(async () => ({ ok: true, json: async () => ({ access_token: "fresh-token", expires_in: 3600 }) }));
    assert.equal(await h.getToken(), "fresh-token");
    assert.equal(h.writes.length, 2);
    assert.equal(h.clock.signals.length, 1);
});

test("OAuth respects caller cancellation", async () => {
    const h = await createTokenHarness(async (_, { signal }) => untilAborted(signal));
    const controller = new AbortController();
    const request = h.getToken(controller.signal);
    const rejected = assert.rejects(request, error => error.name === "AbortError");
    await setImmediate();
    controller.abort();
    await rejected;
    assert.equal(h.calls.length, 1);
    assert.equal(h.writes.length, 0);
});

const profile = {
    id: 123, name: "Example", realm: { name: "Realm", slug: "realm" }, level: 90,
    faction: { name: "Horde" }, character_class: { id: 1 }, race: { name: "Orc" },
    achievement_points: 20, last_login_timestamp: 100,
    achievements_statistics: { href: "statistics" }, pvp_summary: { href: "rating" }, achievements: { href: "achievements" },
};

async function createMinimalHarness(overrides = {}, clock = createClock()) {
    const calls = { profile: 0, season: 0, rating: 0, statistics: 0, records: 0, achievements: 0 };
    const helpFetch = {
        getCharProfile: async () => { calls.profile++; return profile; },
        getCurrentPvPSeasonIndex: async () => { calls.season++; return 100; },
        getRating: async () => { calls.rating++; return { "2v2": { record: 2800 } }; },
        fetchBlizzard: async () => { calls.statistics++; return {}; },
        getAchievById: async (data, id) => { await data; calls.records++; return id === 370 ? 2300 : 2400; },
        getAchievXP: async () => { calls.achievements++; return [{ points: 20 }, [1]]; },
        ...overrides,
    };
    const { context, logs } = makeContext(clock);
    const state = { guard: 200, guardError: null };
    const module = await loadModule(minimalSource, context, {
        dotenv: { default: { config() {} } },
        "node:perf_hooks": { performance: {} },
        "node:url": { pathToFileURL() {} },
        "./blizFetch-helpers/endpointFetchesBliz.js": { default: helpFetch },
        "./blizFetch-helpers/dataGuard.js": { default: async () => { if (state.guardError) throw state.guardError; return state.guard; } },
        "./buildCharSearch.js": { default: () => "example:realm:eu" },
        "./blizFetch-helpers/ratingHelpers.js": { setHighestRatingRecord: (rating, key, value) => {
            rating[key] ??= { record: 0 };
            rating[key].record = Math.max(rating[key].record ?? 0, value);
        } },
    });
    return { clock, calls, logs, state, minimal: module.fetchMinimalCharacter, full: module.default };
}

async function createAchievementsHarness(data) {
    const clock = createClock();
    const calls = { cache: 0, warband: 0, filter: 0 };
    const { context } = makeContext(clock, {
        getSeasonalIdsMap: async () => { calls.cache++; return new Map([["1", { _id: 1 }]]); },
        charToWarband: async () => { calls.warband++; },
        filterAchiev: async (map, points) => { calls.filter++; return { points: points.points }; },
    });
    const method = endpointSource.slice(endpointSource.indexOf("    getAchievXP: async function"), endpointSource.indexOf("    fetchBlizzard: async function"));
    const namespace = await loadModule(`const helpFetch = { fetchBlizzard: async () => input, ${method} }; export default helpFetch;`, Object.assign(context, { input: data }));
    return { getAchievements: namespace.default.getAchievXP, calls, clock };
}

test("unavailable achievements fail cleanly before cache lookups, warband writes or filtering", async () => {
    for (const data of [null, undefined, { code: 429 }, { achievements: null }, { achievements: [], character: null }]) {
        const h = await createAchievementsHarness(data);
        await assert.rejects(h.getAchievements("achievements", { points: 20 }), /Character achievements unavailable/);
        assert.deepEqual(h.calls, { cache: 0, warband: 0, filter: 0 });
        assert.equal(h.clock.timers.size, 0);
    }
});

test("valid achievement responses preserve the achievement and seasonal-ID tuple", async () => {
    const h = await createAchievementsHarness({ achievements: [{ id: 1 }], character: { id: 123 } });
    const result = await h.getAchievements("achievements", { points: 20 });
    assert.equal(result[0].points, 20);
    assert.deepEqual([...result[1]], [1]);
    assert.deepEqual(h.calls, { cache: 1, warband: 1, filter: 1 });
    assert.equal(h.clock.timers.size, 0);
});

test("exhausted achievement requests return false and let a character batch continue", async () => {
    const http = await createRequestHarness(async () => response("", 429));
    const ach = await createAchievementsHarness(null);
    const h = await createMinimalHarness({ getAchievXP: async () => {
        await http.request(url);
        return await ach.getAchievements("achievements", { points: 20 });
    } }, http.clock);
    const result = await finish(Promise.all([
        h.minimal("eu", "realm", "example"), Promise.resolve("other character completed"),
    ]), http.clock);
    assert.deepEqual(result, [false, "other character completed"]);
    assert.equal(http.calls.length, 5);
    assert.equal(ach.calls.warband, 0);
    assert.equal([...h.clock.timers.values()].filter(timer => !timer.abortDeadline).length, 0);
});

test("normal minimal fetch stays quiet, shares statistics, and clears timers", async () => {
    const h = await createMinimalHarness();
    const result = await h.minimal("eu", "realm", "example");
    assert.equal(result.rating["2v2"].record, 2800);
    assert.equal(result.rating["3v3"].record, 2400);
    assert.equal(h.calls.statistics, 1);
    assert.equal(h.calls.records, 2);
    assert.equal(h.logs.info.length, 0);
    assert.equal(h.logs.warn.length, 0);
    assert.equal(h.clock.timers.size, 0);
});

test("supplied profile/rating and 304 guards skip their fetches and timers", async () => {
    const h = await createMinimalHarness();
    const rating = {};
    const result = await h.minimal("eu", "realm", "example", undefined, true, profile, rating);
    assert.equal(result.rating, rating);
    assert.equal(h.calls.profile, 0);
    assert.equal(h.calls.season, 0);
    assert.equal(h.calls.rating, 0);
    assert.equal(h.logs.info.length, 0);
    assert.equal(h.clock.timers.size, 0);
    const guarded = await createMinimalHarness();
    guarded.state.guard = 304;
    assert.equal((await guarded.minimal("eu", "realm", "example")).code, 304);
    assert.equal(guarded.calls.statistics + guarded.calls.rating + guarded.calls.achievements, 0);
    assert.equal(guarded.clock.timers.size, 0);
});

for (const code of [202, 409]) {
    test(`minimal fetch preserves the ${code} envelope and checked-count conversion`, async () => {
        const h = await createMinimalHarness();
        h.state.guard = code;
        const result = await h.minimal("eu", "realm", "example", "5");
        assert.equal(result.code, code);
        assert.equal(result.data.checkedCount, 5);
        assert.equal(result.data.search, "example:realm:eu");
        assert.equal(result.data.achieves.points, 20);
        assert.equal(result.data.rating["2v2"].record, 2800);
        assert.equal(h.clock.timers.size, 0);
    });
}

test("the full-fetch export retains its dependent fields and shared statistics request", async () => {
    const h = await createMinimalHarness({
        getCharProfile: async () => ({ ...profile, media: { href: "media" }, equipment: { href: "gear" }, statistics: { href: "stats" }, specializations: { href: "talents" } }),
        getCharMedia: async () => ({ avatar: "avatar.jpg" }),
        getCharGear: async () => ({ head: "head" }),
        getStats: async () => ({ stamina: 100 }),
        getActiveTalentsCode: async () => ({ talentsCode: "talents" }),
    });
    const result = await h.full("eu", "realm", "example");
    assert.equal(result.media.avatar, "avatar.jpg");
    assert.equal(result.gear.head, "head");
    assert.equal(result.equipmentStats.stamina, 100);
    assert.equal(result.talents.talentsCode, "talents");
    assert.equal(h.calls.statistics, 1);
    assert.equal(h.calls.records, 2);
    assert.equal(h.clock.timers.size, 0);
});

test("an unfinished stage warns once at 20 seconds and clears its timer on completion", async () => {
    let release;
    const h = await createMinimalHarness({ getAchievXP: () => new Promise(resolve => { release = resolve; }) });
    let done = false;
    const request = h.minimal("eu", "realm", "example").then(result => { done = true; return result; });
    await setImmediate();
    assert.equal(h.clock.timers.size, 1);
    await h.clock.advance(20_000);
    assert.equal(done, false);
    assert.equal(h.logs.warn.length, 1);
    assert.match(h.logs.warn[0][0], /example:realm:eu.*achievements still waiting after 20000ms/);
    await h.clock.advance(20_000);
    assert.equal(h.logs.warn.length, 1);
    release([{ points: 20 }, [1]]);
    assert.ok(await request);
    assert.equal(h.clock.timers.size, 0);
});

test("failed stages log their identity and clear timers while preserving false fallback", async () => {
    const h = await createMinimalHarness();
    h.state.guardError = new Error("Mongo unavailable");
    assert.equal(await h.minimal("eu", "realm", "example"), false);
    assert.ok(h.logs.warn.some(([message]) => message.includes("guard failed after")));
    assert.equal(h.clock.timers.size, 0);
});

test("exhausted profile requests let a waiting character batch finish", async () => {
    const http = await createRequestHarness(async (_, { signal }) => untilAborted(signal));
    const h = await createMinimalHarness({ getCharProfile: () => http.request(url) }, http.clock);
    const result = await finish(Promise.all([h.minimal("eu", "realm", "example"), Promise.resolve("other character completed")]), http.clock);
    assert.deepEqual(result, [false, "other character completed"]);
    assert.equal(http.calls.length, 5);
    assert.ok(h.logs.warn.some(([message]) => message.includes("profile still waiting")));
    assert.equal(h.clock.timers.size, 0);
});

test("modified modules parse without live imports", () => {
    for (const source of [endpointSource, minimalSource, tokenSource, gateSource]) new SourceTextModule(source);
});
