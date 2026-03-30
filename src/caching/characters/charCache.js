/** @typedef {import("./charCache.types").CharacterRealm} CharacterRealm */
/** @typedef {import("./charCache.types").CharacterClassInfo} CharacterClassInfo */
/** @typedef {import("./charCache.types").CharacterActiveSpec} CharacterActiveSpec */
/** @typedef {import("./charCache.types").CharacterMedia} CharacterMedia */
/** @typedef {import("./charCache.types").CharacterTalents} CharacterTalents */
/** @typedef {import("./charCache.types").CharacterGuildInsight} CharacterGuildInsight */
/** @typedef {import("./charCache.types").CharacterRecord} CharacterRecord */
import { EventEmitter } from "node:events";
import setCache from "../../helpers/redis/setterRedis.js";
import convertSearch from "../../helpers/convertSearch.js";
import getCache from "../../helpers/redis/getterRedis.js";
import isOlderThanHour from "../../helpers/isOlderThanHour.js";
import Char from "../../Models/Chars.js";
import buildCharSearch from "../../helpers/buildCharSearch.js";
import buildCharacter from "../../helpers/buildCharacter.js";
import fetchData from "../../helpers/blizFetch.js";
import queryCharacterByCredentials from "./utils/queryCharByCredentials.js";
import shipCharById from "./utils/shipCharById.js";
import { findRealmById } from "../realms/realmCache.js";
import { findRealmSearchById } from "../searchCache/realmSearchCach.js";
import { getRegionIdsMap } from "../regions/regionCache.js";
import { getOneAchFromAchCache } from "../achievements/achievesEmt.js";
import { enqueueJobQueueEntry } from "../charQueueCache/jobQueueCache.js";

export const CharCacheEmitter = new EventEmitter();
const hashName = "";
const humanReadableName = "Characters Cache";

CharCacheEmitter.on("update", (msg) => console.log(`[${humanReadableName}] ${msg}`));
CharCacheEmitter.on("error", (msg) => console.error(`[${humanReadableName} ERROR] ${msg}`));
CharCacheEmitter.on("info", (msg) => console.info(`[${humanReadableName} INFO] ${msg}`));
CharCacheEmitter.on("updateRequest", async (search) => {
    try {
        const exist = await getCache(search, hashName, 1);

        if (exist === null || !exist) return;
        const char = await shipCharById(exist.id);
        cacheOneCharacter(char);
    } catch (error) {
        console.warn(error);
    }
});


export async function cacheOneCharacter(charData) {
    let search = charData?.search;
    const _id = charData?._id;
    if (!_id || !search) {
        CharCacheEmitter.emit("error", `cacheOneCharacter invoked with bad params`);
        return null;
    }

    if (charData && search) {
        try {
            await setCache(search, charData.toObject(), hashName, -1, 1);
        } catch (error) {
            await setCache(search, charData, hashName, -1, 1);
        }
        await setCache(`EXPIRE:${search}`, 0, hashName, 3600, 1);
    }
}

export async function retrieveCharacter(params) {
    const { server, realm, name, search } = params ?? {};

    const nextSearch =
        typeof search === "string" && search.split(":").length === 3
            ? search
            : buildCharSearch(server, realm, name);

    if (!nextSearch) {
        CharCacheEmitter.emit(
            "error",
            `retrieveCharacter invoked with bad params: ${JSON.stringify(params)}`,
        );
        return null;
    }

    return await enqueueJobQueueEntry({
        type: "retrieveCharacter",
        data: {
            search: nextSearch,
        },
    });
}

/**
 * Resolves a character by region/server, realm and character name.
 *
 * Expected inputs:
 * - `server`: region or server slug used by the Blizzard API and local search keys, for example `eu` or `us`
 * - `realm`: realm slug or realm name; non-English names may be normalized to a known slug before querying
 * - `name`: character name used to build the cache/database lookup key
 * - `incChecks`: when `true`, increments `checkedCount` for an existing character hit
 * - `renewCache`: when `true`, bypasses the cached value and forces a refresh flow
 *
 * @param {string} server Region/server slug.
 * @param {string} realm Realm slug or raw realm name.
 * @param {string} name Character name.
 * @param {boolean} [incChecks=true] Increment `checkedCount` on successful existing lookups.
 * @param {boolean} [renewCache=false] Ignore current cache and refresh character data.
 * @returns {Promise<CharacterRecord | 404 | null | undefined>}
 * Returns a populated character record on success, `404` when the character or mapped realm
 * cannot be resolved, `null` when caching helpers reject invalid input, or `undefined` if the
 * request fails before a final value is produced.
 */
export async function getCharacter(server, realm, name, incChecks = true, renewCache = false) {
    let character;

    // API try to return accurate data for non english realm eg гордунни => gordunni
    let realmSlug = realm + ":" + server;
    let realmExist = await findRealmById(realmSlug.toLowerCase());
    if (realmExist === null || !realmExist) {
        const realmSearchExist = await findRealmSearchById(realm.toLowerCase());
        if (realmSearchExist) {
            const regionMap = await getRegionIdsMap();

            const entry = [...regionMap.values()].find((e) => e.slug === server.toLowerCase());

            const serverId = entry ? Number(entry._id) : undefined;

            if (!serverId) return 404;
            // const searchRealmExist = await findRealmSearchById(realm.toLowerCase())?.relRealms.find((entry) => entry.region === serverId)?.slug || undefined;
            const searchRealmExist = await findRealmSearchById(realm.toLowerCase());
            if (searchRealmExist !== null && searchRealmExist && searchRealmExist.relRealms) {
                const realmName =
                    searchRealmExist.relRealms.find((entry) => entry.region === serverId)?.slug ||
                    undefined;
                if (realmName && typeof realmName === "string") realm = realmName;
            } else console.info(`getCharacter: ${realm} is missing.`);
        }
    }
    const search = buildCharSearch(server, realm, name);

    try {
        // redis data logic
        if (renewCache === false) character = await getCharFromCacheBySearch(search);
        else if (renewCache === true) character = undefined;

        if (character?.code === 404 && character?.updatedAt) {
            if (!isOlderThanHour(character)) return 404;
        }

        if (character && character !== undefined && character !== null && !character?.code) {
            if (incChecks) {
                Char.findByIdAndUpdate(character._id, {
                    $inc: {
                        checkedCount: 1,
                    },
                }).catch(console.error);
                character.checkedCount = character.checkedCount + 1;
                cacheOneCharacter(character);
            }
            return character;
        } else {
            character = undefined;
        }
    } catch (error) {
        console.warn(error);
        character = undefined;
    }

    // Query database or renew older data |
    //                                    V

    try {
        character = await queryCharacterByCredentials(server, realm, name);
        // if (!character) await Char.findOne({ search: search }); // >? not in variable

        if (character && (isOlderThanHour(character) || renewCache === true)) {
            // renews the cache case if it was explicity set or is older then a hour
            const newData = await fetchData(
                character.server,
                character.playerRealm.slug,
                character.name,
                character.checkedCount,
                renewCache,
            );
            let setter = undefined;
            if (newData?.code && newData?.data?.blizID) {
                character = await Char.findOne({ blizID: newData.data.blizID });
                if (newData.code === 202 || newData.code === 409) setter = newData?.data;
            } else {
                setter = newData;
            }

            if (setter) {
                for (const [key, value] of Object.entries(setter)) {
                    if (character?.[key] && value) character[key] = value;
                }

                character = await Char.findByIdAndUpdate(
                    character._id,
                    { $set: character },
                    { new: true },
                );
            }
        } else if (character) {
            character = await Char.findOneAndUpdate(
                {
                    name: new RegExp(`^${name}$`, "i"),
                    "playerRealm.slug": realm,
                    server: server,
                },
                { $inc: { checkedCount: incChecks ? 1 : 0 } },
                { new: true, upsert: false, timestamps: false },
            );
        }
        if (!character) {
            character = await buildCharacter(server, realm, name);
            if (character === null) {
                await setCache(
                    search,
                    {
                        code: 404,
                        updatedAt: Date.now(),
                    },
                    hashName,
                    3600,
                    1,
                );
                return 404;
            }
        }
        try {
            await character.populate({
                path: "posts",
                populate: {
                    path: "author",
                    select: "username _id",
                },
            });
        } catch (error) {
            // posts can be missing
            console.warn(search + "No posts");
        }
        try {
            if (character?.listAchievements?.length !== 0)
                await character.populate("listAchievements");
        } catch (error) {
            if (typeof character.listAchievements === "object") {
                const shadowAches = [];
                for (const achId of character.listAchievements) {
                    const ach = await getOneAchFromAchCache(achId).catch(() => null);
                    if (ach !== null) shadowAches.push(ach);
                    else console.info(achId);
                }
                if (shadowAches.length !== 0) character.listAchievements = shadowAches;
            } else {
                console.warn(error);
                console.warn(character?.listAchievements);
                if (character.name)
                    console.info("Errored for this character name:" + character.name);
                else console.info("The entry had no name aswell");
            }
        }
        await cacheOneCharacter(character);
        character = character.toObject();
    } catch (error) {
        console.warn(error);
    }
    return character;
}

async function getCharFromCacheBySearch(search) {
    const CSParts = convertSearch(search);
    if (!CSParts) {
        if (!search) {
            CharCacheEmitter.emit(
                "error",
                `getCharFromCacheBySearch has been invoked with bad params\n the function will now exit.`,
            );
            return null;
        }
    }

    search = CSParts.join(":");

    const result = await getCache(search, hashName, 1);
    if (result === null || !result) return null;
    return isOlderThanHour(result) ? undefined : result;
}
