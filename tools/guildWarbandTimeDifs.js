// Run: node tools/guildWarbandTimeDifs.js
// Compares every member of the guild configured in helpFetch.getGuildMembers().
import { open, rename, rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { configDotenv } from "dotenv";
import { compareCharacterPair, mapAchievements, withTimeout } from "./warbandTimeDifs.js";

const OUTPUT = new URL("./guildWarbandTimeDifs.json", import.meta.url);

export function mapGuildMembers(members, region) {
    const seen = new Set();
    return members.flatMap((member, index) => {
        const { name, realm, id } = member.character ?? {};
        if (typeof name !== "string" || !name || typeof realm?.slug !== "string" || !realm.slug) {
            return [{ character: `roster-member-${id ?? index}`, blizID: id ?? null, rank: member.rank,
                error: "Guild roster member is missing a character name or realm slug." }];
        }
        const character = `${name}:${realm.slug}:${region}`;
        const key = character.toLowerCase();
        if (seen.has(key)) return [];
        seen.add(key);
        return [{ character, blizID: id, rank: member.rank,
            url: `https://${region}.api.blizzard.com/profile/wow/character/${encodeURIComponent(realm.slug)}/${encodeURIComponent(name.toLowerCase())}/achievements?namespace=profile-${region}` }];
    });
}

export async function exportGuildComparison(output, characters, metadata) {
    const temporary = new URL(`${output.href}.${process.pid}.tmp`);
    const successful = characters.filter((character) => !character.error);
    const summary = {
        requestedCharacterCount: characters.length,
        successfulCharacterCount: successful.length,
        failedCharacterCount: characters.length - successful.length,
        characterPairCount: 0,
        identicalAchievementSetPairCount: 0,
        allSharedTimestampsMatchPairCount: 0,
        comparedCount: 0,
        equalCount: 0,
        differentCount: 0,
    };
    let signedSum = 0;
    let absoluteSum = 0;
    let maxAbsolute = 0;
    let file;
    try {
        file = await open(temporary, "w");
        const header = { ...metadata, complete: characters.every((character) => !character.error), characters };
        await file.writeFile(`${JSON.stringify(header, null, 2).slice(0, -1)},\n  "pairwise": [\n`);
        // Write each pair immediately, keeping memory proportional to the roster's raw achievements.
        // Per-pair deltas can be reconstructed from the exported character timestamps by achievement ID.
        for (let a = 0; a < successful.length; a += 1) {
            for (let b = a + 1; b < successful.length; b += 1) {
                const { differences, ...pair } = compareCharacterPair(successful[a], successful[b]);
                pair.identicalAchievementIds = pair.comparedCount > 0 && pair.onlyCompletedOnA === 0 && pair.onlyCompletedOnB === 0;
                pair.allSharedTimestampsMatch = pair.comparedCount > 0 && pair.differentCount === 0;
                if (summary.characterPairCount > 0) await file.writeFile(",\n");
                await file.writeFile(`    ${JSON.stringify(pair)}`);
                summary.characterPairCount += 1;
                summary.identicalAchievementSetPairCount += Number(pair.identicalAchievementIds);
                summary.allSharedTimestampsMatchPairCount += Number(pair.allSharedTimestampsMatch);
                summary.comparedCount += pair.comparedCount;
                summary.equalCount += pair.equalCount;
                summary.differentCount += pair.differentCount;
                for (const { differenceMs } of differences) {
                    signedSum += differenceMs;
                    absoluteSum += Math.abs(differenceMs);
                    maxAbsolute = Math.max(maxAbsolute, Math.abs(differenceMs));
                }
            }
        }
        summary.averageDifferenceMs = summary.comparedCount ? signedSum / summary.comparedCount : null;
        summary.averageAbsoluteDifferenceMs = summary.comparedCount ? absoluteSum / summary.comparedCount : null;
        summary.averageAbsoluteDifferenceDays = summary.comparedCount ? absoluteSum / summary.comparedCount / 86_400_000 : null;
        summary.averageNonzeroAbsoluteDifferenceMs = summary.differentCount ? absoluteSum / summary.differentCount : null;
        summary.maxAbsoluteDifferenceMs = summary.comparedCount ? maxAbsolute : null;
        await file.writeFile(`\n  ],\n  "summary": ${JSON.stringify(summary, null, 2)}\n}\n`);
        await file.close();
        file = undefined;
        await rename(temporary, output);
        return summary;
    } finally {
        if (file) await file.close();
        await rm(temporary, { force: true });
    }
}

async function main() {
    configDotenv({ path: fileURLToPath(new URL("../.env", import.meta.url)) });
    const [{ redisCache }, { default: helpFetch }, { default: mongoose }] = await Promise.all([
        import("../src/helpers/redis/connectRedis.js"),
        import("../src/helpers/blizFetch-helpers/endpointFetchesBliz.js"),
        import("mongoose"),
    ]);
    mongoose.set("bufferCommands", false);
    redisCache.on("error", () => {});
    try {
        await withTimeout(() => redisCache.connect(), 15_000, "Redis connection", () => {
            if (redisCache.isOpen) redisCache.destroy();
        });
        const cached = await withTimeout(() => redisCache.hGetAll("acc_wide_aches"), 15_000, "Account-wide cache read");
        const accountWideById = new Map(Object.entries(cached).map(([id, value]) => [Number(id), JSON.parse(value)]));
        if (!accountWideById.size) throw new Error("Redis acc_wide_aches is empty; warm the account-wide achievement cache first.");

        const members = await withTimeout(() => helpFetch.getGuildMembers(), 60_000, "Guild roster request");
        if (!Array.isArray(members) || !members.length) throw new Error("Blizzard did not return a non-empty guild roster.");
        // Roster character URLs carry the region; keep it tied to the configured helper.
        const rosterHref = members.find((member) => member.character?.key?.href)?.character.key.href;
        const region = rosterHref && new URL(rosterHref).hostname.match(/^([a-z]{2})\.api\.blizzard\.com$/)?.[1];
        if (!region) throw new Error("Cannot determine the guild region from the roster's character URLs.");
        const characters = mapGuildMembers(members, region);
        console.info(`Guild roster: ${members.length} entries, ${characters.length} unique members; fetching achievements for every member.`);
        for (const [index, character] of characters.entries()) {
            if (character.error) {
                console.error(`[${index + 1}/${characters.length}] ${character.character}: ${character.error}`);
                continue;
            }
            const controller = new AbortController();
            try {
                const data = await withTimeout(
                    () => helpFetch.fetchBlizzard(character.url, { signal: controller.signal }),
                    60_000, `Blizzard request for ${character.character}`, () => controller.abort(),
                );
                if (!Array.isArray(data?.achievements)) {
                    throw new Error(`No achievements array returned (Blizzard code: ${data?.code ?? "unknown"}, detail: ${data?.detail ?? "none"}).`);
                }
                character.fetchedAt = new Date().toISOString();
                character.receivedAchievementCount = data.achievements.length;
                character.achievements = mapAchievements(data.achievements, accountWideById);
                console.info(`[${index + 1}/${characters.length}] ${character.character}: ${character.achievements.length} completed account-wide achievements`);
            } catch (error) {
                character.error = error.message;
                console.error(`[${index + 1}/${characters.length}] ${character.character}: ${error.message}`);
            }
        }
        console.info("Comparing all successfully fetched guild members...");
        const summary = await exportGuildComparison(OUTPUT, characters, {
            generatedAt: new Date().toISOString(),
            rosterEntryCount: members.length,
            methodology: {
                characterSource: "All ranks and levels from helpFetch.getGuildMembers(); each member's own realm slug, with duplicate identities removed",
                region,
                accountWideSource: "Redis DB 0, acc_wide_aches (same membership as warbandMapping.js)",
                cachedAccountWideAchievementCount: accountWideById.size,
                completionFilter: "The same mapAchievements completion and account-wide filters as tools/warbandTimeDifs.js",
                difference: "timestampB - timestampA for the same achievement ID; positive means B is later",
                pairing: "Each unordered successful member pair once in roster order; only achievement IDs completed on both characters",
                averages: "Signed and absolute arithmetic means include equal timestamps; the overall means weight each shared achievement/pair observation equally",
                dataLayout: "Each character includes its raw completion timestamps; pairwise entries contain comparison summaries to avoid repeating every achievement for every guild pair",
                limitation: "Guild membership does not establish a shared account. Matching achievement sets or timestamps do not prove a shared account. Failed members remain in the export and are excluded from comparisons.",
            },
        });
        console.info(`Exported ${fileURLToPath(OUTPUT)}`);
        console.info(summary);
        if (characters.some((character) => character.error)) process.exitCode = 1;
    } finally {
        if (redisCache.isOpen) redisCache.destroy();
    }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    main().catch((error) => {
        console.error(`Guild achievement diagnostic failed: ${error.message}`);
        process.exitCode = 1;
    });
}
