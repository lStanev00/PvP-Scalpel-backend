import { ACWACache } from "../../caching/achievements/accWideAchesCache.js";
// import { createHash } from "node:crypto";
import Warbands from "../../Models/Warbands.js";

export async function mapWDB(achMap, blizCharID) {
    if (!(achMap instanceof Map)) {
        console.warn(`[mapWBD] achMap is not an isntance of Map`);
        return null;
    }
    if (!blizCharID) {
        console.warn(`[mapWBD] blizChar is not defiend`);
        return null;
    }
    const batch = [];
    let sum = 0; // ids sum buff
    // await ACWACache.loadCache();
    for (const [index, data] of achMap) {
        if (data?.value?.criteria?.is_completed === false) continue;
        if (data?.completed_timestamp) batch.push(ACWACache.getByID(data.id));
        // debugger
    }

    const warbandAchWideResult = (await Promise.all(batch))
        .filter((doesExist) => {
            if (!doesExist) return false;
            const nrId = Number(doesExist._id);
            const timestamp = achMap.get(nrId)?.completed_timestamp;
            if (!timestamp) return false;
            return true;
        })
        .sort((a, b) => Number(a._id) - Number(b._id))
        .map((ach) => {
            const nrId = Number(ach._id);
            sum += nrId;
            const timestamp = achMap.get(nrId)?.completed_timestamp;

            ach.completedAt = timestamp;

            return { achId: nrId, completedAt: timestamp };
        });

    // console.info(warbandAchWideResult.length);
    // console.info(sum);

    // debugger;

    return warbandAchWideResult; // this case is for the tools return
}

async function findWarband(characterId, achievements) {
    // First check whether the character is already assigned.
    const existing = await Warbands.findOne({
        characters: Number(characterId),
    });

    if (existing) return existing;

    const valid = achievements.filter(
        (ach) => ach.achId != null && Number.isSafeInteger(ach.completedAt) && ach.completedAt > 0,
    );

    if (valid.length < 200) return null;

    // Spread 30 probes across the achievement list.
    const step = Math.max(1, Math.ceil(valid.length / 30));

    const probes = valid.filter((_, index) => index % step === 0).slice(0, 30);

    // Find possible warbands using MongoDB.
    const candidates = await Warbands.find({
        $or: probes.map((ach) => ({
            ACWAches: {
                $elemMatch: {
                    achId: ach.achId,
                    completedAt: ach.completedAt,
                },
            },
        })),
    });

    // All incoming achievements indexed by ID.
    const achMap = new Map(valid.map((ach) => [String(ach.achId), ach.completedAt]));

    const matches = candidates.map((warband) => {
        const matchedIds = new Set();

        for (const ach of warband.ACWAches) {
            const id = String(ach.achId);

            if (achMap.get(id) === ach.completedAt) {
                matchedIds.add(id);
            }
        }

        return {
            warband,
            count: matchedIds.size,
        };
    });

    // Best candidate first.
    matches.sort((a, b) => b.count - a.count);

    const best = matches[0];

    if (!best || best.count < 200) return null;

    return best.warband;
}

export default async function charToWarband(blizCharID, remoteAchesMap) {
    blizCharID = Number(blizCharID);
    if (!remoteAchesMap) return undefined;

    const warbandAchWideResult = await mapWDB(remoteAchesMap, blizCharID);

    let wbMatch = await findWarband(blizCharID, warbandAchWideResult);

    if (wbMatch) {
        const isInWb = wbMatch.characters.includes(blizCharID);

        if (!isInWb) {
            wbMatch = await Warbands.findByIdAndUpdate(
                wbMatch._id,
                { $addToSet: { characters: blizCharID } },
                { new: true },
            );
        }

        if (wbMatch.ACWAches.length !== warbandAchWideResult.length) {
            wbMatch = await Warbands.findByIdAndUpdate(
                wbMatch._id,
                { ACWAches: warbandAchWideResult },
                { new: true },
            );
        }
    } else {
        wbMatch = await new Warbands({
            ACWAches: warbandAchWideResult,
            characters: [blizCharID],
        }).save();
        // console.info(`new wbd`)
    }
    // console.info(wbMatch.id)
    return wbMatch.id;
}
