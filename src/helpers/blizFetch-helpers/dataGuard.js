import { CharSearchCacheEmiter } from "../../caching/searchCache/charSearchCache.js";
import Char from "../../Models/Chars.js";
import buildCharSearch from "../buildCharSearch.js";
// import { servicesWorker } from "../../../boot.js";

/**
 * Validates and compares incoming character data with the stored one.
 * Updates only if a difference is detected, without modifying updatedAt.
 *
 * @param {Object} data - The new character data fetched from API or cache.
 * @param {Number|String} data.blizID - Unique Blizzard character ID.
 * @param {String} data.name - Character name.
 * @param {String} data.server - Character’s server name.
 * @param {Object} data.playerRealm - Object containing realm info.
 * @param {String} data.playerRealm.slug - Realm slug.
 * @param {String} data.race - Character’s race.
 * @param {Number|String|Object} data.class - GameClass id or legacy class payload.
 * @param {Number} data.lastLogin - Blizzard’s last login timestamp.
 * @param {Boolean} forceUpdate - The new character data fetched from API or cache.
 *
 * @returns {Promise<Object|Number>}
 * - Returns the `data` object if valid and up to date.
 * - Returns `404` if the character isn’t found.
 * - Returns `409` if the character search credentails are changed.
 * - Returns `304` if there’s no data change.
 * - Returns `202` if there’s partial change e.g class or race.
 * - Return `200` if the data is ready to be refreshed.
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

    if (typeof data.race === "string" && character.race !== data.race) {
        character.race = data.race;
        trigger = true;
    }

    const classId = normalizeRefId(data.class);
    if (classId !== undefined && Number(character.class) !== classId) {
        character.class = classId;
        trigger = true;
    }

    const activeSpecId = normalizeRefId(data.activeSpec);
    if (activeSpecId !== undefined && Number(character.activeSpec) !== activeSpecId) {
        character.activeSpec = activeSpecId;
        trigger = true;
    }

    // Save without modifying updatedAt timestamp
    if (trigger) {
        await character.save({ timestamps: false });

        const newSearch = buildCharSearch({
            server: data.server,
            realm: data.playerRealm.slug,
            name: data.name,
        });
        const oldSearch = character.search;

        if (newSearch !== oldSearch && newSearch !== undefined) {
            character.search = newSearch;
            CharSearchCacheEmiter.emit("purge", oldSearch, newSearch)
            // servicesWorker.postMessage({
            //     type: "purge",
            //     payload: [oldSearch, newSearch],
            // });


            // TODO: jsdoc this return on top of the file
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
