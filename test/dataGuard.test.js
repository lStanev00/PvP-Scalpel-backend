import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { createContext, SourceTextModule, SyntheticModule } from "node:vm";

// Run with: node --experimental-vm-modules --test test/dataGuard.test.js
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const guardSource = read("../src/helpers/blizFetch-helpers/dataGuard.js");
const cacheSource = read("../src/caching/searchCache/charSearchCache.js");
const clone = value => JSON.parse(JSON.stringify(value));
const search = "faraways:hyjal:eu";
const target = {
    _id: "incoming", blizID: 101, name: "Oldname", server: "eu",
    playerRealm: { name: "Hyjal", slug: "hyjal" }, search: "oldname:hyjal:eu",
    race: "Orc", class: 12, activeSpec: 577, lastLogin: 100,
    rating: { "2v2": { record: 3000, currentSeason: { rating: 2500 } } },
    listAchievements: [1, 2], likes: ["user-id"],
};
const owner = { ...clone(target), _id: "previous", blizID: 202, name: "Faraways", search };
const incoming = { blizID: 101, name: "Faraways", server: "eu", playerRealm: { name: "Hyjal", slug: "hyjal" }, lastLogin: 100 };
const duplicate = (field = "search") => Object.assign(new Error(`duplicate ${field}`), { code: 11000, keyPattern: { [field]: 1 } });

async function load(source, context, dependencies = {}, dynamic) {
    const module = new SourceTextModule(source, { context, importModuleDynamically: dynamic });
    await module.link(specifier => {
        const values = dependencies[specifier];
        assert.ok(values, `Unexpected dependency ${specifier}`);
        if (values instanceof SourceTextModule) return values;
        return new SyntheticModule(Object.keys(values), function () {
            for (const [key, value] of Object.entries(values)) this.setExport(key, value);
        }, { context });
    });
    await module.evaluate();
    return module;
}

async function searchBuilder(context) {
    const slugify = await load(read("../src/helpers/slugify.js"), context);
    return (await load(read("../src/helpers/buildCharSearch.js"), context, { "./slugify.js": slugify })).namespace.default;
}

function matches(doc, filter) {
    return Object.entries(filter).every(([key, value]) => {
        const actual = key.split(".").reduce((obj, part) => obj?.[part], doc);
        return value && typeof value === "object" && "$ne" in value
            ? actual !== value.$ne : actual === value;
    });
}

async function guardHarness(options = {}) {
    const state = {
        db: new Map([[target._id, clone(options.target ?? target)]]),
        saves: [], archives: [], lookups: [], profiles: [], cleanups: [], deletes: [], events: [], touches: [],
        ...options.state,
    };
    if (options.owner) state.db.set(options.owner._id, clone(options.owner));
    const context = createContext({ console: { warn() {}, error() {} } });
    const buildCharSearch = await searchBuilder(context);
    const endpoint = await load("export default helpFetch;", Object.assign(context, { helpFetch: {
        getCharProfile: async (...args) => {
            state.profiles.push(args);
            return options.profile ? await options.profile(state) : { id: 101, name: "Faraways", realm: { slug: "hyjal" } };
        },
    } }));
    const Char = {
        findOne(filter) {
            state.lookups.push(clone(filter));
            return { setOptions: async opts => {
                assert.equal(opts.skipCharacterPopulate, true);
                const stored = [...state.db.values()].find(doc => matches(doc, filter));
                if (!stored) return null;
                const doc = clone(stored);
                doc.save = async opts => {
                    state.saves.push(clone(opts));
                    if (options.save) await options.save(state, doc);
                    state.db.set(doc._id, clone(doc));
                };
                doc.updateOne = async update => state.touches.push(clone(update));
                return doc;
            } };
        },
        async updateOne(filter, update, opts) {
            state.archives.push(clone({ filter, update, opts }));
            if (options.beforeArchive) await options.beforeArchive(state);
            const doc = state.db.get(filter._id);
            if (!doc || !matches(doc, filter)) return { matchedCount: 0 };
            Object.assign(doc, clone(update.$set));
            return { matchedCount: 1 };
        },
    };
    const module = await load(guardSource, context, {
        "../../caching/searchCache/charSearchCache.js": {
            CharSearchCacheEmiter: { emit: (...args) => state.events.push(args) },
            removeArchivedCharSearchReferences: async (...args) => {
                state.cleanups.push(args);
                if (options.cleanup) await options.cleanup(state);
            },
        },
        "../../Models/Chars.js": { default: Char },
        "../buildCharSearch.js": { default: buildCharSearch },
        "../redis/deletersRedis.js": { default: async (...args) => state.deletes.push(args) },
        "../redis/connectRedis.js": { CharacterCacheTTL: "CharacterCacheTTL" },
    }, async specifier => {
        assert.equal(specifier, "./endpointFetchesBliz.js");
        return endpoint;
    });
    return { guard: module.namespace.default, state };
}

test("search-only normalization saves once and retains profile/rating/reference fields", async () => {
    const stored = { ...clone(owner), _id: "incoming", blizID: 101, search: " FARAWAYS:Hyjal:EU " };
    const h = await guardHarness({ target: stored });
    assert.equal(await h.guard({ blizID: 101 }, true), 409);
    assert.deepEqual(h.state.db.get("incoming"), { ...stored, search });
    assert.deepEqual(h.state.saves, [{ timestamps: false }]);
    assert.deepEqual(h.state.events, [["purge", stored.search, search]]);
    assert.equal(h.state.profiles.length, 0);
});

test("missing old searches still request a valid canonical index refresh", async () => {
    const stored = { ...clone(target), search: undefined };
    const h = await guardHarness({ target: stored });
    assert.equal(await h.guard({ blizID: 101 }, true), 409);
    assert.equal(h.state.db.get("incoming").search, target.search);
    assert.deepEqual(h.state.events, [["purge", target.search, target.search]]);
    assert.equal(h.state.profiles.length, 0);
});

test("a verified conflict archives only the old search and updates the incoming document", async () => {
    const h = await guardHarness({ owner });
    assert.equal(await h.guard({ ...incoming, race: "Human", class: { _id: "3" }, activeSpec: "253" }, true), 409);
    assert.deepEqual(h.state.db.get("previous"), { ...owner, search: "!archived:previous" });
    const saved = h.state.db.get("incoming");
    assert.equal(saved.name, "Faraways");
    assert.equal(saved.search, search);
    assert.equal(saved.race, "Human");
    assert.equal(saved.class, 3);
    assert.equal(saved.activeSpec, 253);
    assert.deepEqual(saved.rating, target.rating);
    assert.deepEqual(saved.likes, target.likes);
    assert.deepEqual(saved.listAchievements, target.listAchievements);
    assert.deepEqual(h.state.profiles, [["eu", "hyjal", "faraways"]]);
    assert.deepEqual(h.state.archives[0], {
        filter: { _id: "previous", blizID: 202, search, name: "Faraways", server: "eu", "playerRealm.slug": "hyjal" },
        update: { $set: { search: "!archived:previous" } }, opts: { timestamps: false },
    });
    assert.deepEqual(h.state.cleanups, [["previous", search]]);
    assert.deepEqual(h.state.deletes, [[search, "", "CharacterCacheTTL"], [target.search, "", "CharacterCacheTTL"]]);
});

test("unavailable, mismatched-ID and mismatched-identity profiles cannot change either document", async () => {
    for (const profile of [null, { code: 404 }, { id: 202, name: "Faraways", realm: { slug: "hyjal" } },
        { id: 101, name: "Someoneelse", realm: { slug: "hyjal" } },
        { id: 101, name: "Faraways", realm: { slug: "kazzak" } }]) {
        const h = await guardHarness({ owner, profile: async () => profile });
        await assert.rejects(h.guard(incoming, true), /Search conflict.*incoming Blizzard ID 101/);
        assert.deepEqual([...h.state.db.values()], [target, owner]);
        assert.equal(h.state.saves.length + h.state.archives.length + h.state.cleanups.length, 0);
    }
});

test("a failed profile request cannot archive the previous owner", async () => {
    const h = await guardHarness({ owner, profile: async () => { throw new Error("network failed"); } });
    await assert.rejects(h.guard(incoming, true), /network failed/);
    assert.deepEqual([...h.state.db.values()], [target, owner]);
});

test("conditional archiving rechecks an owner that moved during verification", async () => {
    const h = await guardHarness({ owner, beforeArchive: state => {
        state.db.get("previous").search = "moved:hyjal:eu";
        state.db.get("previous").name = "Moved";
    } });
    assert.equal(await h.guard(incoming, true), 409);
    assert.equal(h.state.db.get("previous").search, "moved:hyjal:eu");
    assert.equal(h.state.cleanups.length, 0);
    assert.equal(h.state.profiles.length, 1);
});

test("repeated conditional-update failures stop after one recheck", async () => {
    const h = await guardHarness({ owner, beforeArchive: state => { state.db.get("previous").name += "x"; } });
    await assert.rejects(h.guard(incoming, true), /ownership kept changing/);
    assert.equal(h.state.archives.length, 2);
    assert.equal(h.state.saves.length, 0);
    assert.equal(h.state.db.get("previous").search, search);
});

test("an E11000 race at save time verifies and archives the new owner before one retry", async () => {
    const h = await guardHarness({ save: state => {
        if (state.saves.length === 1) {
            state.db.set("previous", clone(owner));
            throw duplicate();
        }
    } });
    assert.equal(await h.guard(incoming, true), 409);
    assert.equal(h.state.saves.length, 2);
    assert.equal(h.state.profiles.length, 1);
    assert.equal(h.state.db.get("previous").search, "!archived:previous");
});

test("a second duplicate-search failure propagates without further saves", async () => {
    const h = await guardHarness({ save: async () => { throw duplicate(); } });
    await assert.rejects(h.guard(incoming, true), error => error.code === 11000);
    assert.equal(h.state.saves.length, 2);
    assert.equal(h.state.events.length, 0);
});

test("unrelated database errors are not retried", async () => {
    for (const error of [duplicate("blizID"), new Error("Mongo unavailable")]) {
        const h = await guardHarness({ save: async () => { throw error; } });
        await assert.rejects(h.guard(incoming, true), failure => failure === error);
        assert.equal(h.state.saves.length, 1);
    }
});

test("archive cleanup is awaited and survives a later incoming-save failure", async () => {
    let release;
    const h = await guardHarness({ owner,
        cleanup: () => new Promise(resolve => { release = resolve; }),
        save: async () => { throw new Error("target save failed"); },
    });
    const pending = h.guard(incoming, true);
    const rejected = assert.rejects(pending, /target save failed/);
    await setImmediate();
    assert.equal(h.state.saves.length, 0);
    release();
    await rejected;
    assert.equal(h.state.db.get("previous").search, "!archived:previous");
    assert.equal(h.state.db.get("incoming").search, target.search);
    assert.equal(h.state.cleanups.length, 1);
    assert.equal(h.state.deletes.length, 2);
    assert.equal(h.state.events.length, 0);
});

test("cleanup failures still invalidate character-response keys and stop the save", async () => {
    const h = await guardHarness({ owner, cleanup: async () => { throw new Error("index unavailable"); } });
    await assert.rejects(h.guard(incoming, true), /index unavailable/);
    assert.equal(h.state.deletes.length, 2);
    assert.equal(h.state.saves.length, 0);
});

test("normal guard return codes and timestamp behavior remain compatible", async () => {
    const h = await guardHarness();
    for (const data of [null, 1, {}, { blizID: 0 }]) assert.equal(await h.guard(data, true), 400);
    assert.equal(await h.guard({ blizID: 999 }, true), 404);
    assert.equal(await h.guard({ blizID: 101, lastLogin: 100 }, true), 200);
    assert.equal(await h.guard({ blizID: 101, lastLogin: 100 }, false), 304);
    assert.deepEqual(h.state.touches, [{ $currentDate: { updatedAt: true } }]);
    assert.equal(await h.guard({ blizID: 101, race: "Human" }, true), 202);
    assert.equal(h.state.db.get("incoming").race, "Human");
    assert.equal(h.state.profiles.length, 0);
    assert.equal(h.state.events.length, 0);
});

async function cacheHarness(options = {}) {
    const state = { deletes: [], updates: [], reads: [], names: [], setCalls: [], events: [], ...options.state };
    const context = createContext({ console: { info() {}, error() {} } });
    const CharSearchModel = {
        find(filter) {
            state.reads.push(filter);
            const query = {
                select() { return query; },
                setOptions(opts) { assert.equal(opts.autopopulate, false); return query; },
                lean: async () => (options.entries ?? []).map(({ _id }) => ({ _id })),
            };
            return query;
        },
        async updateMany(filter, update) {
            state.updates.push(clone({ filter, update }));
            if (options.updateError) throw options.updateError;
            for (const entry of options.entries ?? []) {
                entry.relChars = entry.relChars.filter(id => id !== update.$pull.relChars);
                entry.searchResult = entry.searchResult.filter(value => value !== update.$pull.searchResult);
            }
        },
    };
    const module = await load(cacheSource, context, {
        events: { EventEmitter },
        "../../Models/Chars.js": { default: { find: () => ({ lean: async () => options.chars ?? [] }) } },
        "../../Models/SearchCharacter.js": { default: CharSearchModel },
        "../../helpers/extractName.js": { default: search => { state.names.push(search); return search.split(":")[0]; } },
        "../../helpers/redis/getterRedis.js": { default: async (...args) => { state.reads.push(args); return {}; }, hashGetAllCache: async () => ({}) },
        "../../helpers/redis/setterRedis.js": { default: async (...args) => state.setCalls.push(args) },
        "../../helpers/redis/deletersRedis.js": { default: async (...args) => state.deletes.push(args) },
        "../../helpers/toMap.js": { default: () => new Map() },
        "./helpers/setDBChars.js": { default: async () => {} },
        "../../helpers/convertSearch.js": { default: () => undefined },
        "../../helpers/buildCharSearch.js": { default: () => search },
    });
    return { cache: module.namespace, state };
}

test("archive cleanup removes only the archived references and displaced search, invalidating affected hashes", async () => {
    const entries = [
        { _id: "fa", relChars: ["previous", "other"], searchResult: [search, "other:realm:eu"] },
        { _id: search, relChars: ["previous"], searchResult: [search] },
    ];
    const h = await cacheHarness({ entries });
    await h.cache.removeArchivedCharSearchReferences("previous", search);
    assert.deepEqual(entries[0], { _id: "fa", relChars: ["other"], searchResult: ["other:realm:eu"] });
    assert.deepEqual(entries[1], { _id: search, relChars: [], searchResult: [] });
    assert.deepEqual(h.state.deletes, [["fa", "CharSearch"], [search, "CharSearch"]]);
    assert.equal(h.state.setCalls.length, 0);
});

test("a failed index update still invalidates affected Redis hashes", async () => {
    const h = await cacheHarness({ entries: [{ _id: "fa" }], updateError: new Error("Mongo unavailable") });
    await assert.rejects(h.cache.removeArchivedCharSearchReferences("previous", search), /Mongo unavailable/);
    assert.deepEqual(h.state.deletes, [["fa", "CharSearch"]]);
});

test("archived searches are skipped during insertion and initial indexing", async () => {
    const h = await cacheHarness({ chars: [{ _id: "previous", search: "!archived:previous" }] });
    await h.cache.insertOneCharSearchMap({ _id: "previous", search: "!archived:previous" });
    await h.cache.initialCharSearchMap();
    assert.equal(h.state.names.length, 0);
    assert.equal(h.state.reads.length, 0);
    assert.equal(h.state.setCalls.length, 0);
});
