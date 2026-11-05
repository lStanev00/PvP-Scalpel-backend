import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { createContext, SourceTextModule, SyntheticModule } from "node:vm";

// Run with: node --experimental-vm-modules --test test/globalLDBS.test.js
const source = readFileSync(new URL("../src/services/globalLDBS.js", import.meta.url), "utf8");
const ratingSource = readFileSync(new URL("../src/helpers/blizFetch-helpers/ratingHelpers.js", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const title = { name: "Rival", media: "title.jpg" };
const character = { id: 123, name: "Example", realm: { id: 554, slug: "realm" } };
const stats = { played: 10, won: 6, lost: 4 };
const tier = { id: 6, key: { href: "tier" } };
const clone = value => JSON.parse(JSON.stringify(value));
const entry = (bracket = "2v2", rating = 2100) => [bracket, rating, stats, tier, character];
const leaderboardEntry = rating => ({ character, rating, season_match_statistics: stats, tier });

async function load(sourceText, context, dependencies = {}) {
    const module = new SourceTextModule(sourceText, { context });
    await module.link(specifier => {
        const values = dependencies[specifier];
        assert.ok(values, `Unexpected dependency: ${specifier}`);
        return new SyntheticModule(Object.keys(values), function () {
            for (const [key, value] of Object.entries(values)) this.setExport(key, value);
        }, { context });
    });
    await module.evaluate();
    return module.namespace;
}

function mongooseDoc(payload) {
    return { ...clone(payload), _id: "mongo-id", rating: new Map(Object.entries(clone(payload.rating))) };
}

async function harness(options = {}) {
    const state = { fetches: [], builds: [], queries: [], bulk: [], deletes: [], events: [], logs: [] };
    const context = createContext({ console: Object.fromEntries(["info", "warn", "error"].map(level => [level, (...args) => state.logs.push(args)])) });
    // Use the real default bracket and record-merging helpers without importing services.
    const ratings = await load(ratingSource.slice(
        ratingSource.indexOf("export function createEmptyRatingBracket"),
        ratingSource.indexOf("/**\n * Resolve a Blizzard dynamic bracket suffix"),
    ), context);
    const boards = options.boards ?? [];
    const dependencies = {
        "../caching/characters/charCache.js": { getCharacter: () => { throw new Error("Unexpected getCharacter"); } },
        "../caching/titles/globalTitles.js": { default: { getOne: async () => title } },
        "../helpers/blizFetch-helpers/dataGuard.js": { default: async () => 200 },
        "../helpers/blizFetch-helpers/endpointFetchesBliz.js": { default: {
            getCurrentPvPSeasonIndex: async () => 100,
            fetchBlizzard: async href => {
                if (!href.startsWith("leaderboard:")) return { leaderboards: boards.map(({ name }, i) => ({ name, key: { href: `leaderboard:${i}` } })) };
                const board = boards[Number(href.split(":")[1])];
                state.events.push(`leaderboard:${board.name}`);
                if (options.onBoard) options.onBoard(board, state);
                return board;
            },
        } },
        "../helpers/blizFetch-helpers/ratingHelpers.js": ratings,
        "../helpers/blizFetch.js": { fetchMinimalCharacter: async (...args) => {
            state.fetches.push(args);
            if (options.fetch) return await options.fetch(...args);
            return {
                blizID: 123, server: "eu", name: "Example", playerRealm: { slug: "realm" },
                search: "example:realm:eu", achieves: { points: 20 }, listAchievements: [1],
                rating: args[6],
            };
        } },
        "../helpers/buildCharacter.js": { default: async (...args) => {
            state.builds.push(args);
            state.events.push("build");
            const saved = options.build ? await options.build(args[5]) : mongooseDoc(args[5]);
            if (saved) state.events.push("saved");
            return saved;
        } },
        "../helpers/buildCharSearch.js": { default: ({ name, realm, server }) => `${name.toLowerCase()}:${realm}:${server}` },
        "../helpers/redis/deletersRedis.js": { default: async (...args) => state.deletes.push(args) },
        "../helpers/redis/connectRedis.js": { CharacterCacheTTL: "CharacterCacheTTL" },
        "../helpers/startBGTask.js": { delay: async () => {} },
        "../helpers/threadBoot.js": { default: async () => {} },
        "../Models/bracketTops/BracketTops.js": { default: { formatBracketTops: async () => {} } },
        "../Models/Chars.js": { default: {
            findOne: async query => { state.queries.push(query); return options.existing ?? null; },
            bulkWrite: async (updates, opts) => {
                state.bulk.push({ updates, opts });
                state.events.push("bulk");
                return { modifiedCount: updates.length, matchedCount: updates.length };
            },
        } },
        "../Models/GameBrackets.js": { default: { findById: async () => ({}), findOne: async () => ({}) } },
        "../Models/Realms.js": { default: { findById: () => ({ select: () => ({ lean: async () => ({ name: "Realm" }) }) }) } },
    };
    const module = await load(`${source}\nexport { handleLooseBracket, pendingCharacterBuilds, charsToUpdate, ratingUpdates };`, context, dependencies);
    return { ...module, state };
}

test("missing characters are saved immediately and reused for later brackets", async () => {
    const h = await harness();
    await h.handleLooseBracket(undefined, entry());
    assert.equal(h.state.builds.length, 1);
    const args = h.state.builds[0];
    assert.deepEqual(args.slice(0, 5), ["eu", "realm", "Example", undefined, true]);
    assert.equal(args[5].achieves.points, 20);
    assert.equal(args[5].rating["2v2"].currentSeason.rating, 2100);
    assert.equal(args[5].brackets, undefined, "Pending metadata is not passed into buildCharacter");
    const saved = h.charsToUpdate.get(123);
    assert.equal(saved._id, "mongo-id");
    assert.equal(h.pendingCharacterBuilds.size, 0);
    await h.handleLooseBracket(saved, entry("3v3", 2300));
    assert.equal(h.state.fetches.length, 1);
    assert.equal(h.state.builds.length, 1);
    assert.equal(saved.rating.get("2v2").currentSeason.rating, 2100);
    assert.equal(saved.rating.get("3v3").currentSeason.rating, 2300);
    assert.equal(h.ratingUpdates.get(123).$set["rating.3v3.currentSeason.rating"], 2300);
});

test("concurrent arrivals share one fetch and brackets arriving during save are queued", async () => {
    let release, snapshot;
    const h = await harness({ build: payload => {
        snapshot = mongooseDoc(payload);
        return new Promise(resolve => { release = () => resolve(snapshot); });
    } });
    const first = h.handleLooseBracket(undefined, entry());
    await setImmediate();
    assert.ok(release);
    await h.handleLooseBracket(undefined, entry("3v3", 2400));
    assert.equal(h.state.fetches.length, 1);
    assert.equal(snapshot.rating.get("3v3").currentSeason.rating, 0);
    release();
    await first;
    assert.equal(h.state.builds.length, 1);
    assert.equal(h.charsToUpdate.get(123).rating.get("3v3").currentSeason.rating, 2400);
    assert.equal(h.ratingUpdates.get(123).$set["rating.3v3.currentSeason.rating"], 2400);
    assert.equal(h.pendingCharacterBuilds.size, 0);
});

test("a stale missing-character lookup reuses the saved document", async () => {
    const h = await harness();
    await h.handleLooseBracket(undefined, entry());
    await h.handleLooseBracket(undefined, entry("3v3", 2200));
    assert.equal(h.state.fetches.length, 1);
    assert.equal(h.state.builds.length, 1);
    assert.equal(h.charsToUpdate.get(123).rating.get("3v3").currentSeason.rating, 2200);
});

test("a duplicate-insert winner's higher records and other bracket fields survive", async () => {
    const h = await harness({ build: payload => {
        const saved = mongooseDoc(payload);
        saved.rating.get("2v2").record = 2900;
        saved.rating.get("2v2").currentSeason.weeklyMatchStatistics = { played: 4 };
        saved.rating.get("3v3").currentSeason.rating = 2600;
        return saved;
    } });
    await h.handleLooseBracket(undefined, entry());
    const saved = h.charsToUpdate.get(123);
    assert.equal(saved.rating.get("2v2").record, 2900);
    assert.equal(saved.rating.get("3v3").currentSeason.rating, 2600);
    assert.equal(h.ratingUpdates.get(123).$max["rating.2v2.record"], 2900);
    assert.equal(h.ratingUpdates.get(123).$set["rating.3v3.currentSeason.rating"], undefined);
    assert.equal(h.ratingUpdates.get(123).$set["rating.2v2.currentSeason.weeklyMatchStatistics"], undefined);
});

for (const code of [202, 409]) {
    test(`successful ${code} fetch envelopes are unwrapped before immediate saving`, async () => {
        const h = await harness({ fetch: async (...args) => ({ code, data: {
            blizID: 123, server: "eu", name: "Example", playerRealm: { slug: "realm" }, rating: args[6],
        } }) });
        await h.handleLooseBracket(undefined, entry());
        assert.equal(h.state.builds[0][5].blizID, 123);
        assert.equal(h.state.builds[0][5].code, undefined);
        assert.ok(h.charsToUpdate.has(123));
    });
}

test("failed or mismatched fetches leave no pending entry and permit retry", async () => {
    for (const failed of [false, { blizID: 999 }]) {
        let calls = 0;
        const h = await harness({ fetch: async (...args) => ++calls === 1 ? failed : {
            blizID: 123, server: "eu", name: "Example", playerRealm: { slug: "realm" }, rating: args[6],
        } });
        await h.handleLooseBracket(undefined, entry());
        assert.equal(h.pendingCharacterBuilds.size, 0);
        assert.equal(h.charsToUpdate.size, 0);
        assert.equal(h.state.builds.length, 0);
        await h.handleLooseBracket(undefined, entry());
        assert.equal(h.state.builds.length, 1);
        assert.ok(h.charsToUpdate.has(123));
    }
});

test("failed or thrown saves clear pending state and permit a later build", async () => {
    for (const throws of [false, true]) {
        let calls = 0;
        const h = await harness({ build: async payload => {
            if (++calls > 1) return mongooseDoc(payload);
            if (throws) throw new Error("Mongo unavailable");
            return null;
        } });
        if (throws) await assert.rejects(h.handleLooseBracket(undefined, entry()), /Mongo unavailable/);
        else await h.handleLooseBracket(undefined, entry());
        assert.equal(h.pendingCharacterBuilds.size, 0);
        assert.equal(h.charsToUpdate.size, 0);
        await h.handleLooseBracket(undefined, entry());
        assert.equal(h.state.builds.length, 2);
        assert.ok(h.charsToUpdate.has(123));
    }
});

test("the full job saves before the next leaderboard and bulk-updates later ratings", async () => {
    const h = await harness({ boards: [
        { name: "2v2", entries: [leaderboardEntry(2100)] },
        { name: "3v3", entries: [leaderboardEntry(2400)] },
    ], onBoard: (board, state) => {
        if (board.name === "3v3") assert.ok(state.events.includes("saved"));
    } });
    assert.equal(h.state.fetches.length, 1);
    assert.equal(h.state.builds.length, 1);
    assert.equal(h.state.queries.length, 1);
    assert.deepEqual(h.state.events, ["leaderboard:2v2", "build", "saved", "leaderboard:3v3", "bulk"]);
    assert.equal(h.state.logs.length, 4);
    assert.match(h.state.logs[0][0], /Leaderboard lookup started: 2v2/);
    assert.match(h.state.logs[1][0], /Leaderboard lookup finished: 2v2 \(\d+ms\)/);
    assert.match(h.state.logs[2][0], /Leaderboard lookup started: 3v3/);
    assert.match(h.state.logs[3][0], /Leaderboard lookup finished: 3v3 \(\d+ms\)/);
    const [{ updateOne }] = h.state.bulk[0].updates;
    assert.equal(updateOne.filter._id, "mongo-id");
    assert.equal(updateOne.update.$set["rating.2v2.currentSeason.rating"], 2100);
    assert.equal(updateOne.update.$set["rating.3v3.currentSeason.rating"], 2400);
    assert.equal(updateOne.update.$max["rating.3v3.record"], 2400);
    assert.equal(updateOne.update.$set.rating, undefined);
    assert.equal(h.state.bulk[0].opts.ordered, false);
    assert.deepEqual(h.state.deletes, [["example:realm:eu", "", "CharacterCacheTTL"]]);
});
