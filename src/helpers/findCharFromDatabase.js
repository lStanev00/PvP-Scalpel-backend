import Char from "../Models/Chars.js";
import buildCharSearch from "./buildCharSearch.js";
import normalizeCharacterSearch from "./normalizeCharacterSearch.js";

/**
 * Finds a character by an already formatted unique indexed `search` key.
 *
 * @param {string} search - Canonical `name:realm:server` search key.
 * @returns {Promise<import("mongoose").HydratedDocument<unknown> | null>} Matching character document, or `null` when not found/invalid.
 */
async function bySearch(search) {
    const normalizedSearch = normalizeCharacterSearch(search);

    if (!normalizedSearch) return null;

    try {
        return await Char.findOne({ search: normalizedSearch });
    } catch (error) {
        console.warn(error);
        return null;
    }
}

/**
 * Finds a character by server, realm slug, and character name.
 *
 * This preserves the legacy lookup shape used by guild patching. Prefer
 * `findCharFromDatabase.bySearch` for exact identity lookups because it uses the unique
 * indexed `search` key.
 *
 * @param {string} server - Region/server slug, for example `eu` or `us`.
 * @param {string} realm - Realm slug.
 * @param {string} name - Character name.
 * @returns {Promise<import("mongoose").HydratedDocument<unknown> | null>} Matching character document, or `null` when not found.
 */
async function byCredentials(server, realm, name) {
    let character = undefined;

    try {
        character = await Char.findOne({
            name: name,
            "playerRealm.slug": realm,
            server: server,
        });
        if (character) return character;
    } catch (error) {
        console.warn(error);
    }
    return null;
}

/**
 * Finds a character by either a canonical search key or raw credentials.
 *
 * When all three arguments are provided, the method builds the indexed
 * `name:realm:server` key before querying. When only the first argument is
 * provided, it is treated as an already formatted search key.
 *
 * @param {string} searchOrServer - Canonical search key, or a server/region slug when `realm` and `name` are provided.
 * @param {string} [realm] - Realm slug used when building the search key from credentials.
 * @param {string} [name] - Character name used when building the search key from credentials.
 * @returns {Promise<import("mongoose").HydratedDocument<unknown> | null>} Matching character document, or `null` when not found/invalid.
 */
async function bySearchOrCredentials(searchOrServer, realm = undefined, name = undefined) {
    if (realm === undefined || name === undefined) return bySearch(searchOrServer);

    const search = buildCharSearch({ server: searchOrServer, realm, name });
    return bySearch(search);
}

/**
 * Finds a character from a Blizzard PvP summary URL.
 *
 * Expected URL shape:
 * `https://{server}.api.blizzard.com/profile/wow/character/{realm}/{name}/pvp-summary?namespace=profile-{server}`.
 * Extra query params, such as `locale`, are allowed.
 *
 * @param {string} pvpUrl - Blizzard character PvP summary URL.
 * @returns {Promise<import("mongoose").HydratedDocument<unknown> | null>} Matching character document, or `null` when the URL is invalid/not found.
 */
async function byPvPUrl(pvpUrl) {
    if (typeof pvpUrl !== "string") return null;

    let url;
    try {
        url = new URL(pvpUrl);
    } catch {
        return null;
    }

    const hostMatch = url.hostname.match(/^(?<server>[^.]+)\.api\.blizzard\.com$/);
    if (!hostMatch?.groups?.server) return null;

    const pathParts = url.pathname.split("/").filter(Boolean);
    const [profile, wow, character, realm, name, summary] = pathParts;
    if (
        pathParts.length !== 6 ||
        profile !== "profile" ||
        wow !== "wow" ||
        character !== "character" ||
        summary !== "pvp-summary"
    ) {
        return null;
    }

    const server = hostMatch.groups.server;
    const namespace = url.searchParams.get("namespace");
    if (namespace && namespace !== `profile-${server}`) return null;

    const search = buildCharSearch({
        server,
        realm: decodeURIComponent(realm),
        name: decodeURIComponent(name),
    });

    return bySearch(search);
}

/**
 * Character database lookup helpers.
 *
 * @type {{
 *   bySearch: typeof bySearch,
 *   byCredentials: typeof byCredentials,
 *   bySearchOrCredentials: typeof bySearchOrCredentials,
 *   byPvPUrl: typeof byPvPUrl,
 * }}
 */
const findCharFromDatabase = {
    bySearch,
    byCredentials,
    bySearchOrCredentials,
    byPvPUrl,
};

export default findCharFromDatabase;
