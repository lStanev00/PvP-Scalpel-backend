import { servicesWorker } from "../../../DBMS.js";
import Char from "../../Models/Chars.js";
import buildCharSearch from "../buildCharSearch.js";

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
 * @param {Object} data.class - Object containing class info.
 * @param {String} data.class.name - Class name.
 * @param {Number} data.lastLogin - Blizzard’s last login timestamp.
 *
 * @returns {Promise<Object|Number>}
 * - Returns the `data` object if valid and up to date.
 * - Returns `404` if the character isn’t found.
 * - Returns `304` if there’s no data change.
 * - Returns `202` if there’s partial change e.g name or race.
 * - Return `200` if the data is ready to be refreshed.
 */
export default async function dataGuard(data) {
    // Basic input validation
    if (!data || typeof data !== "object") return 400;
    if (!data.blizID) return 400;

    const character = await Char.findOne({ blizID: data.blizID });
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

    if (data.class && typeof data.class === "object" && character.class?.name !== data.class.name) {
        character.class = data.class;
        trigger = true;
    }

    // Save without modifying updatedAt timestamp
    if (trigger) {
        await character.save({ timestamps: false });

        const newSearch = buildCharSearch(data.server, data.playerRealm.slug, data.name);
        const oldSearch = character.search;

        if (newSearch !== oldSearch) {
            character.search = newSearch;
            servicesWorker.postMessage({
                type: "purge",
                payload: [oldSearch, newSearch],
            });
        }
        return 202;
    }

    // If no field changed but lastLogin is identical, no update needed
    if (character.lastLogin === data.lastLogin && trigger === false) return 304;

    return 200;
}
