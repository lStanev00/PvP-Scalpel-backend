import { getGameClass } from "../../caching/gameClasses/gameClassesCache.js";
import Char from "../../Models/Chars.js";
import { getGameSpecializationByID } from "../../caching/gameSpecializations/gameSpecializationsCache.js";
import blizzardPvpClassSlug from "../blizzardPvpClassSlug.js";
import getRatingEntries from "../getRatingEntries.js";
import slugify from "../slugify.js";

/**
 * @typedef {object} RatingTitle
 * @property {string | undefined} name
 * @property {string | undefined} media
 */

/**
 * @typedef {object} RatingCurrentSeason
 * @property {number} rating
 * @property {RatingTitle | undefined} title
 * @property {unknown} seasonMatchStatistics
 * @property {unknown} weeklyMatchStatistics
 */

/**
 * @typedef {object} CharacterRatingBracket
 * @property {RatingCurrentSeason} currentSeason
 * @property {unknown} lastSeasonLadder
 * @property {number | null} record
 * @property {string | undefined} [_id]
 */

/**
 * @typedef {Record<string, CharacterRatingBracket | Record<string, never>>} CharacterRatingResult
 */

/**
 * @typedef {Map<string, CharacterRatingBracket> | Record<string, CharacterRatingBracket> | null | undefined} RatingCollection
 */

/**
 * @typedef {object} ExtRatingRecords
 * @property {number | null | undefined} blitzRecord
 * @property {number | null | undefined} SSRecord
 * @property {number | null | undefined} rbgRecord
 * @property {number | null | undefined} twosRecord
 * @property {number | null | undefined} threesRecord
 * @property {number | null | undefined} activeSpecId
 * @property {number | null | undefined} classId
 * @property {Array<{specId: number | null | undefined, maxRating: number | null | undefined}> | undefined} ssEntries
 * @property {Array<{specId: number | null | undefined, maxRating: number | null | undefined}> | undefined} blitzEntries
 */

/**
 * Create a fresh bracket value for the character rating map.
 * The current rating and record start at 0; title, statistics, and
 * last-season ladder data are unset until a source provides them.
 *
 * @returns {CharacterRatingBracket} A new bracket with initialized current-season data.
 */
export function createEmptyRatingBracket() {
    return {
        currentSeason: {
            rating: 0,
            title: undefined,
            seasonMatchStatistics: undefined,
            weeklyMatchStatistics: undefined,
        },
        lastSeasonLadder: undefined,
        record: 0,
    };
}

/**
 * Create the base rating object returned when Blizzard has no bracket data.
 *
 * @returns {CharacterRatingResult}
 */
export function createDefaultRatingResult() {
    return {
        // Keep legacy placeholder keys in the API/cache shape even when no data exists.
        // solo: {},
        // solo_bg: {},
        "2v2": createEmptyRatingBracket(),
        "3v3": createEmptyRatingBracket(),
        rbg: createEmptyRatingBracket(),
    };
}

/**
 * Cast a string or number into a finite number.
 *
 * @param {unknown} value
 * @returns {number | undefined}
 */
export function toFiniteNumber(value) {
    if (typeof value !== "number" && typeof value !== "string") return undefined;
    if (typeof value === "string" && value.trim().length === 0) return undefined;
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : undefined;
}

/**
 * Return the highest valid numeric record from a mixed list.
 *
 * @param {...unknown} values
 * @returns {number | undefined}
 */
export function highestRecord(...values) {
    const records = values.map(toFiniteNumber).filter((value) => value !== undefined);
    return records.length === 0 ? undefined : Math.max(...records);
}

/**
 * Read one bracket from either a Mongoose Map or a plain object.
 *
 * @param {RatingCollection} rating
 * @param {string | undefined} bracketKey
 * @returns {CharacterRatingBracket | undefined}
 */
export function getRatingBracket(rating, bracketKey) {
    if (!rating || !bracketKey) return undefined;

    // Mongoose Map values hydrate as Map in documents, but serialize as plain objects.
    if (rating instanceof Map) return rating.get(bracketKey);
    return rating[bracketKey];
}

/**
 * Ensure a bracket exists and set its record to the highest available value.
 *
 * @param {CharacterRatingResult} result
 * @param {string | undefined} bracketKey
 * @param {unknown} record
 * @returns {void}
 */
export function setRecordOnlyRatingBracket(result, bracketKey, record) {
    if (!bracketKey || record === undefined) return;

    if (!result[bracketKey]) {
        result[bracketKey] = createEmptyRatingBracket();
    }

    result[bracketKey].record = highestRecord(result[bracketKey]?.record, record) ?? record;
}

/**
 * Set a rating bracket record without replacing a higher existing value.
 *
 * @param {CharacterRatingResult} rating
 * @param {string} bracketKey
 * @param {unknown} record
 * @returns {void}
 */
export function setHighestRatingRecord(rating, bracketKey, record) {
    if (!rating[bracketKey]) rating[bracketKey] = { record: null };

    const highest = highestRecord(rating[bracketKey].record, record);
    rating[bracketKey].record = highest ?? null;
}

/**
 * Resolve a Blizzard dynamic bracket suffix from one specialization ID.
 *
 * @param {number | string | null | undefined} specId
 * @returns {Promise<string | undefined>}
 */
async function getExtDynamicRatingSuffix(specId) {
    const normalizedSpecId = toFiniteNumber(specId);
    if (!Number.isInteger(normalizedSpecId)) return undefined;

    try {
        const spec = await getGameSpecializationByID(normalizedSpecId);
        if (!spec?.name || !spec?.relClass) return undefined;

        const gameClass = await getGameClass({ id: spec.relClass });
        const classSlug = blizzardPvpClassSlug(gameClass?.name);
        const specSlug = slugify(spec.name)?.replaceAll("-", "");
        if (!classSlug || !specSlug) return undefined;

        return `${classSlug}-${specSlug}`;
    } catch (error) {
        console.warn(`[getRating] Failed to resolve dynamic rating key for spec ${normalizedSpecId}.`);
        console.warn(error);
        return undefined;
    }
}

/**
 * Apply ext-only and stored record-only ratings to a rating result.
 *
 * This preserves records even when Blizzard omits the related current-season
 * bracket from the PvP summary.
 *
 * @param {CharacterRatingResult} result
 * @param {ExtRatingRecords | undefined} retrievedRecords
 * @param {RatingCollection} ratingCharRefDbase
 * @returns {Promise<void>}
 */
export async function applyExternalRecordOnlyRatings(result, retrievedRecords, ratingCharRefDbase) {
    const staticRecordBrackets = [
        { bracketKey: "2v2", record: retrievedRecords?.twosRecord },
        { bracketKey: "3v3", record: retrievedRecords?.threesRecord },
        { bracketKey: "rbg", record: retrievedRecords?.rbgRecord },
    ];

    for (const { bracketKey, record } of staticRecordBrackets) {
        const storedBracket = getRatingBracket(ratingCharRefDbase, bracketKey);
        const highestStaticRecord = highestRecord(record, storedBracket?.record, result[bracketKey]?.record);
        setRecordOnlyRatingBracket(result, bracketKey, highestStaticRecord);
    }

    // Preserve the best stored record for every dynamic bracket.
    for (const [bracketKey, storedBracket] of getRatingEntries(ratingCharRefDbase)) {
        if (!bracketKey.startsWith("blitz-") && !bracketKey.startsWith("shuffle-")) continue;

        const storedRecord = highestRecord(storedBracket?.record);
        if (storedRecord === undefined || storedRecord <= 0) continue;

        setRecordOnlyRatingBracket(result, bracketKey, storedRecord);
    }

    // Per-spec maxima replace stored dynamic records, which may contain an old
    // overall solo record incorrectly attributed to the active specialization.
    const externalRecords = new Map();
    for (const [bracketSlug, entries] of [
        ["blitz", retrievedRecords?.blitzEntries],
        ["shuffle", retrievedRecords?.ssEntries],
    ]) {
        if (!Array.isArray(entries)) continue;

        for (const entry of entries) {
            const record = toFiniteNumber(entry?.maxRating);
            if (record === undefined || record <= 0) continue;

            const dynamicSuffix = await getExtDynamicRatingSuffix(entry?.specId);
            if (!dynamicSuffix) continue;

            const bracketKey = `${bracketSlug}-${dynamicSuffix}`;
            externalRecords.set(bracketKey, highestRecord(externalRecords.get(bracketKey), record));
        }
    }

    for (const [bracketKey, record] of externalRecords) {
        result[bracketKey] ??= createEmptyRatingBracket();
        // result[bracketKey].record = highestRecord(record, result[bracketKey].currentSeason?.rating) ?? record;
        result[bracketKey].record = record;
    }
}

/**
 * Find a stored PvP tier image for the rating's current EU leaderboard band.
 * Bands start at 0, 975, 1175, 1375, 1575, 1775, 1925, 2075, and 2275;
 * each band ends before the next start, and Elite has no upper limit.
 * Searches all character rating brackets in MongoDB and prefers the most
 * recently updated character. No Blizzard request is made.
 *
 * @param {number} rating - Nonnegative PvP rating to classify.
 * @returns {Promise<string | null>} Stored final image URL, or `null` for invalid input or no match.
 */
export async function getRatingMediaByRange(rating) {
    if (typeof rating !== "number" || !Number.isFinite(rating) || rating < 0) {
        return null;
    }

    const tierStarts = [0, 975, 1175, 1375, 1575, 1775, 1925, 2075, 2275];
    const tierIndex = tierStarts.findLastIndex((start) => rating >= start);
    const lower = tierStarts[tierIndex];
    const upper = tierStarts[tierIndex + 1];
    const range = upper === undefined ? { $gte: lower } : { $gte: lower, $lt: upper };

    const [match] = await Char.aggregate([
        { $project: {
            updatedAt: 1,
            ratingEntries: { $objectToArray: { $ifNull: ["$rating", {}] } },
        } },
        { $unwind: "$ratingEntries" },
        { $match: {
            "ratingEntries.v.currentSeason.rating": range,
            "ratingEntries.v.currentSeason.title.media": { $type: "string", $ne: "" },
        } },
        { $sort: { updatedAt: -1, _id: -1, "ratingEntries.k": 1 } },
        { $limit: 1 },
        { $project: { _id: 0, media: "$ratingEntries.v.currentSeason.title.media" } },
    ]);

    return match?.media ?? null;
}
