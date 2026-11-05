import { CharSearchCacheEmiter, removeArchivedCharSearchReferences } from "../../caching/searchCache/charSearchCache.js";
import Char from "../../Models/Chars.js";
import buildCharSearch from "../buildCharSearch.js";
import delCache from "../redis/deletersRedis.js";
import { CharacterCacheTTL } from "../redis/connectRedis.js";
// import { servicesWorker } from "../../../boot.js";

/**
 * Validates and compares incoming character data with the stored one.
 * Saves changes to compared fields without modifying updatedAt.
 * The 304 branch updates only updatedAt to mark the character as checked.
 *
 * @param {Object} data - The new character data fetched from API or cache.
 * @param {Number|String} data.blizID - Unique Blizzard character ID.
 * @param {String} data.name - Character name.
 * @param {String} data.server - Character’s server name.
 * @param {Object} data.playerRealm - Object containing realm info.
 * @param {String} data.playerRealm.slug - Realm slug.
 * @param {String} [data.race] - Character’s race; omitted or empty values are ignored.
 * @param {Number|String|Object} [data.class] - GameClass ID or reference; omitted or falsy values are ignored.
 * @param {Number|String|Object} [data.activeSpec] - GameSpecialization ID or reference; omitted or falsy values are ignored.
 * @param {Number} data.lastLogin - Last login timestamp used for comparison, not saved here.
 * @param {Boolean} forceUpdate - Only explicit false allows the 304 shortcut; other values proceed to 200 when no compared fields changed.
 *
 * @returns {Promise<200 | 202 | 304 | 400 | 404 | 409>}
 * - 400: Input is not an object, blizID is missing/falsy, or stored/resulting identity cannot form a search.
 * - 404: No stored character matches blizID.
 * - 409: Compared fields were saved, search changed, and an async search-cache purge was started (not awaited).
 * - 202: Compared fields were saved without a search change.
 * - 304: No compared fields changed, lastLogin matches, and forceUpdate is false; updatedAt was refreshed.
 * - 200: No compared fields changed and the 304 conditions were not met; refresh should proceed.
 * @throws {Error} Search ownership cannot be verified or repaired, or a database operation fails.
 */
export default async function dataGuard(data, forceUpdate) {
    // Basic input validation
    if (!data || typeof data !== "object") return 400;
    if (!data.blizID) return 400;

    const character = await Char.findOne({ blizID: data.blizID }).setOptions({ skipCharacterPopulate: true });
    if (!character) return 404;

    let trigger = false;

    // Defensive comparisons with optional chaining and type checks
    if (typeof data.name === "string" && character.name !== data.name) {
        character.name = data.name;
        trigger = true;
    }

    if (typeof data.server === "string" && character.server !== data.server) {
        character.server = data.server;
        trigger = true;
    }

    if (
        data.playerRealm &&
        typeof data.playerRealm === "object" &&
        character.playerRealm?.slug !== data.playerRealm.slug
    ) {
        character.playerRealm = data.playerRealm;
        trigger = true;
    }

    if (data.race && typeof data.race === "string" && character.race !== data.race) {
        character.race = data.race;
        trigger = true;
    }

    if(data.class ) {

        const classId = normalizeRefId(data.class);
        if (classId !== undefined && Number(character.class) !== classId) {
            character.class = classId;
            trigger = true;
        }

    }

    if(data.activeSpec ) {

        const activeSpecId = normalizeRefId(data.activeSpec);
        if (activeSpecId !== undefined && Number(character.activeSpec) !== activeSpecId) {
            character.activeSpec = activeSpecId;
            trigger = true;
        }

    }

    // Correct the search even when the profile fields themselves already match.
    const newSearch = buildCharSearch({
        server: character.server,
        realm: character.playerRealm?.slug,
        name: character.name,
    });
    if (!newSearch) return 400;
    const oldSearch = character.search;
    const searchChanged = newSearch !== oldSearch;

    // Save without modifying updatedAt timestamp.
    if (trigger || searchChanged) {
        if (searchChanged) character.search = newSearch;

        for (let attempt = 0; attempt < 2; attempt++) {
            if (searchChanged) await releaseVerifiedSearch(character, newSearch, oldSearch);
            try {
                await character.save({ timestamps: false });
                break;
            } catch (error) {
                // An owner may have claimed the search since the preflight lookup.
                if (attempt === 0 && searchChanged && isDuplicateSearch(error)) continue;
                throw error;
            }
        }

        if (searchChanged) {
            // A missing old search has no index to purge; rebuild the canonical entry instead.
            const purgeSearch = typeof oldSearch === "string" && oldSearch.trim() ? oldSearch : newSearch;
            CharSearchCacheEmiter.emit("purge", purgeSearch, newSearch);
            // servicesWorker.postMessage({
            //     type: "purge",
            //     payload: [oldSearch, newSearch],
            // });


            return 409;
        }
        return 202;
    }

    // If no field changed but lastLogin is identical, no update needed
    if (character.lastLogin === data.lastLogin && forceUpdate === false) {
        await character.updateOne({ $currentDate: { updatedAt: true } }); // cast update so next time the redis cache access this it knows is fresh
        return 304;
    }

    return 200;
}

async function releaseVerifiedSearch(character, search, oldSearch) {
    // Recheck once when a concurrent worker changes the owner before archiving.
    for (let attempt = 0; attempt < 2; attempt++) {
        const owner = await Char.findOne({ search, _id: { $ne: character._id } })
            .setOptions({ skipCharacterPopulate: true });
        if (!owner) return;

        const [name, realm, server] = search.split(":");
        const { default: helpFetch } = await import("./endpointFetchesBliz.js");
        const profile = await helpFetch.getCharProfile(server, realm, name);
        const verifiedSearch = buildCharSearch({ server, realm: profile?.realm?.slug, name: profile?.name });
        if (Number(profile?.id) !== Number(character.blizID) || verifiedSearch !== search ||
            Number(owner.blizID) === Number(character.blizID)) {
            throw new Error(`Search conflict at ${search}: incoming Blizzard ID ${character.blizID}, stored owner ${owner.blizID}, verified profile ${profile?.id ?? "unavailable"}`);
        }

        const archived = await Char.updateOne({
            _id: owner._id,
            blizID: owner.blizID,
            search,
            name: owner.name,
            server: owner.server,
            "playerRealm.slug": owner.playerRealm?.slug,
        }, { $set: { search: `!archived:${owner._id}` } }, { timestamps: false });
        if (!archived.matchedCount) continue;

        // Archiving is valid independently of whether the incoming save later succeeds.
        try {
            await removeArchivedCharSearchReferences(owner._id, search);
        } finally {
            await Promise.all([...new Set([search, oldSearch])]
                .filter(key => typeof key === "string" && key.length > 0)
                .map(key => delCache(key, "", CharacterCacheTTL)));
        }
        return;
    }
    throw new Error(`Search conflict at ${search}: ownership kept changing; update skipped`);
}

function isDuplicateSearch(error) {
    return error?.code === 11000 && (error.keyPattern?.search === 1 ||
        typeof error.keyValue?.search === "string" || /\bindex: search_1\b/.test(error.message ?? ""));
}

function normalizeRefId(value) {
    if (typeof value === "number" && Number.isInteger(value)) return value;

    if (typeof value === "string") {
        const trimmed = value.trim();
        if (/^\d+$/.test(trimmed)) return Number(trimmed);
        return undefined;
    }

    if (value && typeof value === "object") {
        return normalizeRefId(value._id ?? value.id);
    }

    return undefined;
}
