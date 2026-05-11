import { Schema, model } from "mongoose";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Raw row shape from `itemBonus.json` before it is normalized for MongoDB.
 *
 * Type `43` rows describe PvP item-level bonus mappings. Other row types are
 * ignored by the seed normalizer.
 *
 * @typedef {object} ItemBonusSeedRow
 * @property {number} [id] DB2 bonus id from the source file.
 * @property {number} [val_1] PvP item level granted by this bonus row.
 * @property {number} [val_2] Secondary source value retained for diagnostics.
 * @property {number} [val_3] Secondary source value retained for diagnostics.
 * @property {number} [val_4] Secondary source value retained for diagnostics.
 * @property {number} [id_node] Bonus tree node id.
 * @property {number} [id_parent] Parent bonus tree node id.
 * @property {number} [type] Source row type. PvP ilvl rows use `43`.
 * @property {number} [index] Source row index.
 * @property {string} [sourceBuild] WoW build that produced the source data.
 * @property {number} [db2Id] Existing normalized DB2 id.
 * @property {number} [pvpIlvl] Existing normalized PvP item level.
 */

/**
 * Normalized MongoDB document payload for a PvP item-level bonus mapping.
 *
 * @typedef {object} ItemBonusDoc
 * @property {number} db2Id Unique DB2 bonus id.
 * @property {number} pvpIlvl PvP item level granted by the bonus.
 * @property {number} [val2] Secondary source value retained for diagnostics.
 * @property {number} [val3] Secondary source value retained for diagnostics.
 * @property {number} [val4] Secondary source value retained for diagnostics.
 * @property {number} [idNode] Bonus tree node id.
 * @property {number} [idParent] Parent bonus tree node id.
 * @property {number} type Source row type. PvP ilvl rows use `43`.
 * @property {number} [index] Source row index.
 * @property {string} [sourceBuild] WoW build that produced the source data.
 * @property {unknown} [raw] Original source row.
 */

/**
 * Summary returned after seeding `gameItemBonuses`.
 *
 * @typedef {object} ItemBonusSeedResult
 * @property {number} matched Existing MongoDB documents matched by `db2Id`.
 * @property {number} modified Existing MongoDB documents modified.
 * @property {number} upserted New MongoDB documents inserted.
 * @property {number} total Normalized rows attempted.
 */

/**
 * Result of resolving a character item `bonus_list` against known PvP ilvl rows.
 *
 * @typedef {object} ItemBonusResolveResult
 * @property {number | null} pvpIlvl Resolved PvP item level, or `null` when no match exists.
 * @property {boolean} isPvp Whether the bonus list matched a known PvP ilvl row.
 * @property {(ItemBonusDoc & Record<string, unknown>) | null} selected Highest-priority matching row.
 * @property {(ItemBonusDoc & Record<string, unknown>)[]} matches All matching rows returned by MongoDB.
 */

/**
 * Mongoose model with typed ItemBonus statics for editor IntelliSense.
 *
 * @typedef {import("mongoose").Model<ItemBonusDoc> & {
 *   normalizeSeedRow(row: ItemBonusSeedRow | null | undefined): ItemBonusDoc | ItemBonusSeedRow | null,
 *   seedFromJson(filePath?: string): Promise<ItemBonusSeedResult>,
 *   resolvePvpIlvlFromBonusList(bonusList?: Array<number | string>): Promise<ItemBonusResolveResult>,
 * }} ItemBonusModel
 */

const ItemBonusSchema = new Schema(
    {
        db2Id: {
            type: Number,
            required: true,
            unique: true,
            index: true,
        },
        pvpIlvl: {
            type: Number,
            required: true,
            index: true,
        },
        val2: Number,
        val3: Number,
        val4: Number,
        idNode: {
            type: Number,
            index: true,
        },
        idParent: {
            type: Number,
            index: true,
        },
        type: {
            type: Number,
            required: true,
            index: true,
        },
        index: Number,
        sourceBuild: String,
        raw: Schema.Types.Mixed,
    },
    {
        timestamps: true,
        versionKey: false,
    },
);

/**
 * Convert one source JSON row into the MongoDB document shape.
 *
 * Rows that are not objects, or object rows whose `type` is not `43`, are
 * ignored by returning `null`. Already-normalized rows with `db2Id` are returned
 * unchanged so the same method can handle both raw seed data and exported docs.
 *
 * @param {ItemBonusSeedRow | null | undefined} row
 * @returns {ItemBonusDoc | ItemBonusSeedRow | null}
 */
ItemBonusSchema.statics.normalizeSeedRow = function normalizeSeedRow(row) {
    if (!row || typeof row !== "object") return null;

    if (row.db2Id) {
        return row;
    }

    if (row.type !== 43) {
        return null;
    }

    return {
        db2Id: row.id,
        pvpIlvl: row.val_1,
        val2: row.val_2,
        val3: row.val_3,
        val4: row.val_4,
        idNode: row.id_node,
        idParent: row.id_parent,
        type: row.type,
        index: row.index,
        sourceBuild: row.sourceBuild || process.env.WOW_BUILD || "unknown",
        raw: row,
    };
};

/**
 * Read item bonus data from JSON and upsert PvP ilvl bonus rows into MongoDB.
 *
 * The seed file must contain an array. Only rows normalized to integer `db2Id`
 * and integer `pvpIlvl` are written.
 *
 * @param {string} [filePath] Absolute or relative path to a JSON seed file.
 * @returns {Promise<ItemBonusSeedResult>}
 */
ItemBonusSchema.statics.seedFromJson = async function seedFromJson(filePath = path.join(__dirname, "itemBonus.json")) {
    const content = await readFile(filePath, "utf-8");
    const rows = JSON.parse(content);

    if (!Array.isArray(rows)) {
        throw new TypeError("itemBonus.json must contain an array");
    }

    const docs = rows
        .map((row) => this.normalizeSeedRow(row))
        .filter(Boolean)
        .filter((row) => Number.isInteger(row.db2Id))
        .filter((row) => Number.isInteger(row.pvpIlvl));

    if (!docs.length) {
        return {
            matched: 0,
            modified: 0,
            upserted: 0,
            total: 0,
        };
    }

    const ops = docs.map((doc) => ({
        updateOne: {
            filter: {
                db2Id: doc.db2Id,
            },
            update: {
                $set: doc,
            },
            upsert: true,
        },
    }));

    const result = await this.bulkWrite(ops, {
        ordered: false,
    });

    return {
        matched: result.matchedCount,
        modified: result.modifiedCount,
        upserted: result.upsertedCount,
        total: docs.length,
    };
};

/**
 * Resolve the PvP item level represented by a Blizzard equipment `bonus_list`.
 *
 * Matching checks `db2Id`, `idNode`, and `idParent`. Node or parent matches are
 * prioritized over direct DB2 id matches, then ties are resolved by highest PvP
 * item level.
 *
 * @param {Array<number | string>} [bonusList=[]] Blizzard bonus ids from an equipped item.
 * @returns {Promise<ItemBonusResolveResult>}
 */
ItemBonusSchema.statics.resolvePvpIlvlFromBonusList = async function resolvePvpIlvlFromBonusList(bonusList = []) {
    const ids = bonusList
        .map(Number)
        .filter(Number.isInteger);

    if (!ids.length) {
        return {
            pvpIlvl: null,
            isPvp: false,
            selected: null,
            matches: [],
        };
    }

    const matches = await this.find({
        $or: [
            {
                db2Id: {
                    $in: ids,
                },
            },
            {
                idNode: {
                    $in: ids,
                },
            },
            {
                idParent: {
                    $in: ids,
                },
            },
        ],
    }).lean();

    if (!matches.length) {
        return {
            pvpIlvl: null,
            isPvp: false,
            selected: null,
            matches: [],
        };
    }

    const selected = matches
        .map((row) => ({
            ...row,
            priority: ids.includes(row.idNode) || ids.includes(row.idParent) ? 3 : 1,
        }))
        .sort((a, b) => {
            if (b.priority !== a.priority) return b.priority - a.priority;
            return b.pvpIlvl - a.pvpIlvl;
        })[0];

    return {
        pvpIlvl: selected.pvpIlvl,
        isPvp: true,
        selected,
        matches,
    };
};

const ItemBonus = /** @type {ItemBonusModel} */ (
    model("ItemBonus", ItemBonusSchema, "gameItemBonuses")
);

export default ItemBonus;
