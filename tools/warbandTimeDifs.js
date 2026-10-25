// Run from the repository root: node tools/warbandTimeDifs.js
// Samples MongoDB characters, uses Redis and fetchBlizzard, and exports tools/warbandTimeDifs.json.
import { writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { configDotenv } from "dotenv";

const CHARACTER_COUNT = 20;
const OUTPUT = new URL("./warbandTimeDifs.json", import.meta.url);
const DAY_MS = 86_400_000;

export function summarizeDifferences(differences) {
    if (!differences.length) {
        return {
            comparedCount: 0, equalCount: 0, differentCount: 0,
            averageDifferenceMs: null, averageAbsoluteDifferenceMs: null,
            averageAbsoluteDifferenceDays: null, averageNonzeroAbsoluteDifferenceMs: null,
            medianDifferenceMs: null, minDifferenceMs: null, maxDifferenceMs: null,
            maxAbsoluteDifferenceMs: null,
        };
    }
    const sorted = [...differences].sort((a, b) => a - b);
    const absoluteSum = sorted.reduce((sum, value) => sum + Math.abs(value), 0);
    const differentCount = sorted.filter((value) => value !== 0).length;
    const middle = Math.floor(sorted.length / 2);
    const averageAbsoluteDifferenceMs = absoluteSum / sorted.length;
    return {
        comparedCount: sorted.length,
        equalCount: sorted.length - differentCount,
        differentCount,
        averageDifferenceMs: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
        averageAbsoluteDifferenceMs,
        averageAbsoluteDifferenceDays: averageAbsoluteDifferenceMs / DAY_MS,
        averageNonzeroAbsoluteDifferenceMs: differentCount ? absoluteSum / differentCount : null,
        medianDifferenceMs: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
        minDifferenceMs: sorted[0],
        maxDifferenceMs: sorted.at(-1),
        maxAbsoluteDifferenceMs: Math.max(Math.abs(sorted[0]), Math.abs(sorted.at(-1))),
    };
}

export function mapAchievements(achievements, accountWideById) {
    // Match getAchievXP's ID map and warbandMapping.js's completion/cache filters.
    const byId = new Map(achievements.map((entry) => [entry.id, entry]));
    const mapped = [];
    for (const entry of byId.values()) {
        if (entry?.value?.criteria?.is_completed === false || !entry?.completed_timestamp) continue;
        const metadata = accountWideById.get(Number(entry.id));
        if (!metadata) continue;
        if (!Number.isSafeInteger(entry.completed_timestamp) || entry.completed_timestamp <= 0) continue;
        if (!Number.isFinite(new Date(entry.completed_timestamp).getTime())) continue;
        mapped.push({
            id: Number(entry.id),
            name: metadata.name ?? entry.achievement?.name ?? null,
            completed_timestamp: entry.completed_timestamp,
            completedAt: new Date(entry.completed_timestamp).toISOString(),
        });
    }
    return mapped.sort((a, b) => a.id - b.id);
}

export function compareCharacterPair(characterA, characterB) {
    const achievementsA = new Map(characterA.achievements.map((entry) => [entry.id, entry]));
    const differences = [];
    for (const achievementB of characterB.achievements) {
        const achievementA = achievementsA.get(achievementB.id);
        if (!achievementA) continue;
        const differenceMs = achievementB.completed_timestamp - achievementA.completed_timestamp;
        differences.push({
            id: achievementB.id,
            name: achievementB.name,
            timestampA: achievementA.completed_timestamp,
            timestampB: achievementB.completed_timestamp,
            differenceMs,
            differenceSeconds: differenceMs / 1_000,
            differenceDays: differenceMs / DAY_MS,
        });
    }
    return {
        characterA: characterA.character,
        characterB: characterB.character,
        onlyCompletedOnA: characterA.achievements.length - differences.length,
        onlyCompletedOnB: characterB.achievements.length - differences.length,
        ...summarizeDifferences(differences.map((entry) => entry.differenceMs)),
        differences,
    };
}

export function compareCharacters(characters) {
    const successful = characters.filter((character) => !character.error);
    const pairwise = [];
    const allDifferences = [];
    for (let a = 0; a < successful.length; a += 1) {
        const characterA = successful[a];
        for (let b = a + 1; b < successful.length; b += 1) {
            const pair = compareCharacterPair(characterA, successful[b]);
            allDifferences.push(...pair.differences.map((entry) => entry.differenceMs));
            pairwise.push(pair);
        }
    }

    const byAchievement = new Map();
    for (const character of successful) {
        for (const entry of character.achievements) {
            if (!byAchievement.has(entry.id)) {
                byAchievement.set(entry.id, { id: entry.id, name: entry.name, completions: [] });
            }
            byAchievement.get(entry.id).completions.push({
                character: character.character,
                completed_timestamp: entry.completed_timestamp,
                completedAt: entry.completedAt,
            });
        }
    }
    const achievements = [...byAchievement.values()].map((entry) => {
        const timestamps = entry.completions.map((completion) => completion.completed_timestamp);
        const absoluteDifferences = [];
        for (let a = 0; a < timestamps.length; a += 1) {
            for (let b = a + 1; b < timestamps.length; b += 1) {
                absoluteDifferences.push(Math.abs(timestamps[b] - timestamps[a]));
            }
        }
        const earliestTimestamp = Math.min(...timestamps);
        const latestTimestamp = Math.max(...timestamps);
        return {
            ...entry,
            characterCount: timestamps.length,
            distinctTimestampCount: new Set(timestamps).size,
            earliestTimestamp,
            latestTimestamp,
            spreadMs: latestTimestamp - earliestTimestamp,
            spreadDays: (latestTimestamp - earliestTimestamp) / DAY_MS,
            averageAbsoluteDifferenceMs: summarizeDifferences(absoluteDifferences).averageAbsoluteDifferenceMs,
        };
    }).sort((a, b) => b.spreadMs - a.spreadMs || a.id - b.id);

    return {
        summary: {
            requestedCharacterCount: characters.length,
            successfulCharacterCount: successful.length,
            failedCharacterCount: characters.length - successful.length,
            characterPairCount: pairwise.length,
            uniqueAchievementCount: achievements.length,
            sharedAchievementCount: achievements.filter((entry) => entry.characterCount > 1).length,
            differingAchievementCount: achievements.filter((entry) => entry.distinctTimestampCount > 1).length,
            ...summarizeDifferences(allDifferences),
        },
        pairwise,
        achievements,
    };
}

export async function withTimeout(operation, milliseconds, label, onTimeout = () => {}) {
    let timer;
    try {
        return await Promise.race([
            operation(),
            new Promise((_, reject) => {
                timer = setTimeout(() => {
                    reject(new Error(`${label} timed out after ${milliseconds / 1_000}s`));
                    onTimeout();
                }, milliseconds);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

async function main() {
    configDotenv({ path: fileURLToPath(new URL("../.env", import.meta.url)) });
    // Load the environment before imports that construct the shared Redis client.
    const [{ redisCache }, { default: helpFetch }, { default: mongoose }, { default: Char }] = await Promise.all([
        import("../src/helpers/redis/connectRedis.js"),
        import("../src/helpers/blizFetch-helpers/endpointFetchesBliz.js"),
        import("mongoose"),
        import("../src/Models/Chars.js"),
    ]);
    // Mongo is disconnected after sampling; don't buffer fetchBlizzard's error logging.
    mongoose.set("bufferCommands", false);
    redisCache.on("error", () => {});

    try {
        if (!process.env.MONGODB_CONNECTION) throw new Error("MONGODB_CONNECTION is required to sample characters.");
        let sampledCharacters;
        try {
            await mongoose.connect(process.env.MONGODB_CONNECTION, {
                serverSelectionTimeoutMS: 15_000,
                autoIndex: false,
                autoCreate: false,
            });
            sampledCharacters = await Char.collection.aggregate([
                // Require only a usable API identity; no account, rating, or activity filters.
                { $match: {
                    name: { $type: "string", $ne: "" },
                    "playerRealm.slug": { $type: "string", $ne: "" },
                    server: { $type: "string", $ne: "" },
                } },
                { $sample: { size: CHARACTER_COUNT } },
                { $project: { _id: 0, name: 1, "playerRealm.slug": 1, server: 1 } },
            ], { maxTimeMS: 30_000 }).toArray();
        } finally {
            await mongoose.disconnect();
        }
        if (sampledCharacters.length !== CHARACTER_COUNT) {
            throw new Error(`Expected ${CHARACTER_COUNT} random characters, but MongoDB returned ${sampledCharacters.length}.`);
        }
        const selectedCharacters = sampledCharacters.map(({ name, playerRealm, server }) =>
            `${name}:${playerRealm.slug}:${server}`,
        );
        console.info(`Randomly sampled ${selectedCharacters.length} characters from MongoDB.`);

        // Only DB 0 is needed; avoid connectRedis(), which also configures server notifications.
        await withTimeout(() => redisCache.connect(), 15_000, "Redis connection", () => {
            if (redisCache.isOpen) redisCache.destroy();
        });
        const cached = await withTimeout(() => redisCache.hGetAll("acc_wide_aches"), 15_000, "Account-wide cache read");
        const accountWideById = new Map(Object.entries(cached).map(([id, value]) => [Number(id), JSON.parse(value)]));
        if (!accountWideById.size) throw new Error("Redis acc_wide_aches is empty; warm the account-wide achievement cache first.");

        const characters = [];
        for (const character of selectedCharacters) {
            const [name, realm, region] = character.split(":");
            const url = `https://${region}.api.blizzard.com/profile/wow/character/${encodeURIComponent(realm)}/${encodeURIComponent(name.toLowerCase())}/achievements?namespace=profile-${region}`;
            const controller = new AbortController();
            try {
                const data = await withTimeout(
                    () => helpFetch.fetchBlizzard(url, { signal: controller.signal }),
                    60_000, `Blizzard request for ${character}`, () => controller.abort(),
                );
                if (!Array.isArray(data?.achievements)) {
                    throw new Error(`No achievements array returned (Blizzard code: ${data?.code ?? "unknown"}, detail: ${data?.detail ?? "none"}).`);
                }
                const achievements = mapAchievements(data.achievements, accountWideById);
                characters.push({ character, url, fetchedAt: new Date().toISOString(), receivedAchievementCount: data.achievements.length, achievements });
                console.info(`${character}: ${achievements.length} completed account-wide achievements`);
            } catch (error) {
                characters.push({ character, url, error: error.message });
                console.error(`${character}: ${error.message}`);
            }
        }
        const report = {
            generatedAt: new Date().toISOString(),
            complete: characters.every((character) => !character.error),
            methodology: {
                characterSource: `MongoDB ${Char.collection.collectionName}: $sample of ${CHARACTER_COUNT} characters with a name, realm slug, and region; a fresh random sample on each run`,
                accountWideSource: "Redis DB 0, acc_wide_aches (same membership as warbandMapping.js)",
                cachedAccountWideAchievementCount: accountWideById.size,
                completionFilter: "completed_timestamp exists, is a valid positive integer in milliseconds, and value.criteria.is_completed is not false",
                difference: "timestampB - timestampA for the same achievement ID; positive means B is later",
                pairing: "Each unordered character pair once, in MongoDB sample order; only achievements completed on both characters",
                averages: "Signed and absolute arithmetic means include equal timestamps; overall means weight each shared achievement/character-pair observation equally",
                limitation: "Randomly sampled characters are not known to share an account. Timestamp differences describe the API data; they do not establish why Blizzard assigned different completion times. Account-wide membership is based on the existing cache.",
            },
            characters,
            ...compareCharacters(characters),
        };
        await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
        console.info(`Exported ${fileURLToPath(OUTPUT)}`);
        console.info(report.summary);
        if (!report.complete) process.exitCode = 1;
    } finally {
        if (redisCache.isOpen) redisCache.destroy();
    }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    main().catch((error) => {
        console.error(`Warband timestamp diagnostic failed: ${error.message}`);
        process.exitCode = 1;
    });
}
