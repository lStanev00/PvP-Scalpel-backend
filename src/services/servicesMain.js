import { CharacterCacheTTL } from "../helpers/redis/connectRedis.js";
import delCache from "../helpers/redis/deletersRedis.js";
import slugify from "../helpers/slugify.js";
import Char from "../Models/Chars.js";
import GameClass from "../Models/GameClass.js";
import GameSpecialization from "../Models/GameSpecialization.js";
import JobQueue from "../workers/jobQueue/jobQueue.js";
import workerPatchGuildMembersData from "../workers/PatchGuildMembersData/workerPatchGuildMembersData.js";
import workerupdateDBAchieves from "../workers/updateDBAchievements/workerUDBA.js";
import workerUpdateRealm from "../workers/updateRealm/workerUpdateRealm.js";

const jobQueue = new JobQueue();
const MIGRATION_BATCH_SIZE = 500;

function toFiniteNumber(value) {
    if (typeof value !== "number" && typeof value !== "string") return undefined;
    if (typeof value === "string" && value.trim().length === 0) return undefined;
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : undefined;
}

function highestRecord(...values) {
    const records = values.map(toFiniteNumber).filter((value) => value !== undefined);
    return records.length === 0 ? undefined : Math.max(...records);
}

async function buildFaultyDynamicRatingKeyMap() {
    const [classes, specializations] = await Promise.all([
        GameClass.find().select("_id name").lean(),
        GameSpecialization.find().select("name relClass").lean(),
    ]);
    const classNameById = new Map(classes.map((gameClass) => [gameClass._id, gameClass.name]));
    const replacements = new Map();

    for (const specialization of specializations) {
        const className = classNameById.get(specialization.relClass);
        if (!className || !specialization.name) continue;

        const correctSuffix = slugify(`${className} ${specialization.name}`);
        const faultySuffix = slugify(`${specialization.name} ${className}`);
        if (!correctSuffix || !faultySuffix || correctSuffix === faultySuffix) continue;

        replacements.set(`blitz-${faultySuffix}`, `blitz-${correctSuffix}`);
        replacements.set(`shuffle-${faultySuffix}`, `shuffle-${correctSuffix}`);
    }

    return replacements;
}

function buildDynamicRatingRepairUpdate(rating, faultyKeyMap) {
    const $set = {};
    const $unset = {};

    for (const [faultyKey, correctKey] of faultyKeyMap) {
        const faultyBracket = rating?.[faultyKey];
        if (!faultyBracket) continue;

        const correctBracket = rating?.[correctKey];
        const replacementBracket = correctBracket
            ? {
                ...correctBracket,
                record: highestRecord(correctBracket.record, faultyBracket.record)
                    ?? correctBracket.record
                    ?? faultyBracket.record
                    ?? null,
            }
            : faultyBracket;

        $set[`rating.${correctKey}`] = replacementBracket;
        $unset[`rating.${faultyKey}`] = "";
    }

    if (Object.keys($unset).length === 0) return undefined;
    return { $set, $unset };
}

async function repairFaultyDynamicRatingKeys() {
    try {
        const faultyKeyMap = await buildFaultyDynamicRatingKeyMap();
        if (faultyKeyMap.size === 0) return;

        const cursor = Char.find({ rating: { $exists: true } })
            .select("rating search")
            .lean()
            .cursor();
        let bulkOps = [];
        let repairedCount = 0;
        const cacheKeysToDelete = [];

        for await (const character of cursor) {
            const update = buildDynamicRatingRepairUpdate(character.rating, faultyKeyMap);
            if (!update) continue;

            bulkOps.push({
                updateOne: {
                    filter: { _id: character._id },
                    update,
                },
            });
            repairedCount += 1;

            if (character.search) cacheKeysToDelete.push(character.search);

            if (bulkOps.length >= MIGRATION_BATCH_SIZE) {
                await Char.bulkWrite(bulkOps, { ordered: false, timestamps: false });
                bulkOps = [];
            }
        }

        if (bulkOps.length > 0) {
            await Char.bulkWrite(bulkOps, { ordered: false, timestamps: false });
        }

        if (cacheKeysToDelete.length > 0) {
            await Promise.allSettled(
                cacheKeysToDelete.map((search) => delCache(search, "", CharacterCacheTTL)),
            );
        }

        if (repairedCount > 0) {
            console.info(`[Services] Repaired ${repairedCount} faulty dynamic rating key sets.`);
        }
    } catch (error) {
        console.warn("[Services] Failed to repair faulty dynamic rating keys.");
        console.warn(error);
    }
}

async function delegacy() {

    try {
        await repairFaultyDynamicRatingKeys();

        const result = await Char.updateMany(
            { $or: [{ legacyRetrieved: true }, { legacyRetrived: true }] },
            { $set: { legacyRetrieved: false }, $unset: { legacyRetrived: "" } },
            { timestamps: false },
        );

        console.info(`[Services] Reset legacyRetrieved on ${result.modifiedCount ?? 0} characters.`);
    } catch (error) {
        console.warn("[Services] Failed to reset legacyRetrieved flags.");
        console.warn(error);
    }
}

export default async function startServices() {
    await delegacy();
    await jobQueue.initialize();

    // let warmupFinished = false;
    // const cacheWormupTask = fork("src/workers/initialChace/workerInitialCache.js");
    // cacheWormupTask.on("exit",() => {
    //     warmupFinished=true;
    // });
    // while (warmupFinished !== true) await delay(1000);
    // console.info("[Cache] Initial cache warmup finished.");

    workerUpdateRealm();
    workerPatchGuildMembersData();
    workerupdateDBAchieves();

    console.info("[Cache] All workers started.");
}
