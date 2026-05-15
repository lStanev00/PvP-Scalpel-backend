import mongoose from "mongoose";
import { DBconnect } from "../src/helpers/mongoHelper.js";
import Char from "../src/Models/Chars.js";
import GameClass from "../src/Models/GameClass.js";
import GameSpecialization from "../src/Models/GameSpecialization.js";

const dryRun = process.argv.includes("--dry-run");
const batchSize = 500;

await DBconnect(true);

try {
    const [classes, specializations] = await Promise.all([
        GameClass.collection.find({}, { projection: { _id: 1, name: 1 } }).toArray(),
        GameSpecialization.collection.find({}, { projection: { _id: 1, name: 1, relClass: 1 } }).toArray(),
    ]);

    const classIdsByName = new Map(classes.map((entry) => [normalizeName(entry.name), entry._id]));
    const specIdsByClassAndName = new Map();
    const specIdsByName = new Map();

    for (const spec of specializations) {
        const specName = normalizeName(spec.name);
        specIdsByClassAndName.set(`${spec.relClass}:${specName}`, spec._id);

        const existing = specIdsByName.get(specName);
        if (existing === undefined) {
            specIdsByName.set(specName, spec._id);
        } else if (existing !== spec._id) {
            specIdsByName.set(specName, null);
        }
    }

    const cursor = Char.collection.find(
        {},
        {
            projection: {
                _id: 1,
                name: 1,
                server: 1,
                playerRealm: 1,
                class: 1,
                activeSpec: 1,
            },
        },
    );

    let checked = 0;
    let updated = 0;
    let unresolved = 0;
    let ops = [];

    for await (const character of cursor) {
        checked += 1;

        const classId = resolveClassId(character.class, classIdsByName);
        const specId = resolveSpecId(character.activeSpec, classId, specIdsByClassAndName, specIdsByName);
        const $set = {};

        if (classId !== undefined && Number(character.class) !== classId) $set.class = classId;
        if (specId !== undefined && Number(character.activeSpec) !== specId) $set.activeSpec = specId;

        if (Object.keys($set).length === 0) {
            if (
                (needsMigration(character.class) && classId === undefined) ||
                (needsMigration(character.activeSpec) && specId === undefined)
            ) {
                unresolved += 1;
                console.warn(
                    `[unresolved] ${character.name ?? character._id} ` +
                        `${character.playerRealm?.slug ?? "unknown"} ${character.server ?? "unknown"} ` +
                        `class=${JSON.stringify(character.class)} activeSpec=${JSON.stringify(character.activeSpec)}`,
                );
            }
            continue;
        }

        updated += 1;
        ops.push({
            updateOne: {
                filter: { _id: character._id },
                update: { $set },
            },
        });

        if (ops.length >= batchSize) {
            await flush(ops);
            ops = [];
        }
    }

    await flush(ops);

    console.info(
        `Character ref migration ${dryRun ? "dry run" : "complete"}: ` +
            `checked=${checked}, updated=${updated}, unresolved=${unresolved}`,
    );
} finally {
    await mongoose.disconnect();
}

async function flush(ops) {
    if (ops.length === 0 || dryRun) return;
    await Char.collection.bulkWrite(ops, { ordered: false });
}

function resolveClassId(value, classIdsByName) {
    const numericId = normalizeNumericId(value);
    if (numericId !== undefined) return numericId;

    const name = normalizeRefName(value);
    if (!name) return undefined;

    return classIdsByName.get(name);
}

function resolveSpecId(value, classId, specIdsByClassAndName, specIdsByName) {
    const numericId = normalizeNumericId(value);
    if (numericId !== undefined) return numericId;

    const name = normalizeRefName(value);
    if (!name) return undefined;

    if (classId !== undefined) {
        const specId = specIdsByClassAndName.get(`${classId}:${name}`);
        if (specId !== undefined) return specId;
    }

    return specIdsByName.get(name) ?? undefined;
}

function normalizeNumericId(value) {
    if (typeof value === "number" && Number.isInteger(value)) return value;

    if (typeof value === "string") {
        const trimmed = value.trim();
        if (/^\d+$/.test(trimmed)) return Number(trimmed);
        return undefined;
    }

    if (value && typeof value === "object") return normalizeNumericId(value._id ?? value.id);

    return undefined;
}

function normalizeRefName(value) {
    if (typeof value === "string" && !/^\d+$/.test(value.trim())) return normalizeName(value);
    if (value && typeof value === "object" && typeof value.name === "string") return normalizeName(value.name);
    return undefined;
}

function normalizeName(name) {
    return typeof name === "string" ? name.trim().toLowerCase() : "";
}

function needsMigration(value) {
    return normalizeNumericId(value) === undefined && normalizeRefName(value) !== undefined;
}
