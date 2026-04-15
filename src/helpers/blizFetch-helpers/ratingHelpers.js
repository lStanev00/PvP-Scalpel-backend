import { getGameSpecializationByID } from "../../caching/gameSpecializations/gameSpecializationsCache.js";
import GameClass from "../../Models/GameClass.js";
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
 */

/**
 * Create an empty rating bracket with the same shape as the Char rating map values.
 *
 * @returns {CharacterRatingBracket}
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
        solo: {},
        solo_bg: {},
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
 * Resolve the dynamic rating bracket suffix from ext active spec and class ids.
 *
 * @param {ExtRatingRecords | undefined} retrievedRecords
 * @returns {Promise<string | undefined>}
 */
async function getExtDynamicRatingSuffix(retrievedRecords) {
    const activeSpecId = toFiniteNumber(retrievedRecords?.activeSpecId);
    const classId = toFiniteNumber(retrievedRecords?.classId);
    if (activeSpecId === undefined || classId === undefined) return undefined;

    try {
        const [activeSpec, gameClass] = await Promise.all([
            getGameSpecializationByID(activeSpecId),
            GameClass.findById(classId).select("name").lean(),
        ]);

        if (!activeSpec?.name || !gameClass?.name) return undefined;

        return slugify(`${gameClass.name} ${activeSpec.name}`);
    } catch (error) {
        console.warn("[getRating] Failed to resolve ext dynamic rating key.");
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

    // Preserve existing dynamic records when ext is skipped because legacy retrieval already ran.
    for (const [bracketKey, storedBracket] of getRatingEntries(ratingCharRefDbase)) {
        if (!bracketKey.startsWith("blitz-") && !bracketKey.startsWith("shuffle-")) continue;
        if (result[bracketKey]) continue;

        const storedRecord = highestRecord(storedBracket?.record);
        if (storedRecord === undefined || storedRecord <= 0) continue;

        setRecordOnlyRatingBracket(result, bracketKey, storedRecord);
    }

    const dynamicSuffix = await getExtDynamicRatingSuffix(retrievedRecords);
    if (!dynamicSuffix) return;

    const dynamicRecordBrackets = [
        { bracketKey: `blitz-${dynamicSuffix}`, record: retrievedRecords?.blitzRecord },
        { bracketKey: `shuffle-${dynamicSuffix}`, record: retrievedRecords?.SSRecord },
    ];

    // Add record-only dynamic brackets when Blizzard omits current-season bracket data.
    for (const { bracketKey, record } of dynamicRecordBrackets) {
        const storedBracket = getRatingBracket(ratingCharRefDbase, bracketKey);
        const highestDynamicRecord = highestRecord(record, storedBracket?.record, result[bracketKey]?.record);
        if (highestDynamicRecord === undefined || highestDynamicRecord <= 0) continue;
        setRecordOnlyRatingBracket(result, bracketKey, highestDynamicRecord);
    }
}
