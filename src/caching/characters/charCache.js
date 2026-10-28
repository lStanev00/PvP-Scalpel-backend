/** @typedef {import("../../workers/jobQueue/jobQueue.types.js").CharacterRetrievalParams} CharacterRetrievalParams */
/** @typedef {import("../../workers/jobQueue/jobQueue.types.js").CharacterRetrievalOptions} CharacterRetrievalOptions */
/** @typedef {import("../../workers/jobQueue/jobQueue.types.js").RetrieveCharacterQueueJob} RetrieveCharacterQueueJob */
/** @typedef {import("../../workers/jobQueue/jobQueue.types.js").RetrieveCharacterResult} RetrieveCharacterResult */
/** @typedef {import("./charCache.types").CharacterRealm} CharacterRealm */
/** @typedef {import("./charCache.types").CharacterClassInfo} CharacterClassInfo */
/** @typedef {import("./charCache.types").CharacterActiveSpec} CharacterActiveSpec */
/** @typedef {import("./charCache.types").CharacterMedia} CharacterMedia */
/** @typedef {import("./charCache.types").CharacterTalents} CharacterTalents */
/** @typedef {import("./charCache.types").CharacterGuildInsight} CharacterGuildInsight */
/** @typedef {import("./charCache.types.js").CharacterRecord} CharacterRecord */
import { EventEmitter, once } from "node:events";
import setCache from "../../helpers/redis/setterRedis.js";
import getCache from "../../helpers/redis/getterRedis.js";
import delCache from "../../helpers/redis/deletersRedis.js";
import isOlderThanHour from "../../helpers/isOlderThanHour.js";
import Char from "../../Models/Chars.js";
import buildCharSearch from "../../helpers/buildCharSearch.js";
import normalizeCharacterSearch from "../../helpers/normalizeCharacterSearch.js";
import buildCharacter from "../../helpers/buildCharacter.js";
import fetchData, { fetchMinimalCharacter } from "../../helpers/blizFetch.js";
import shipCharById from "./utils/shipCharById.js";
import { findRealmById } from "../realms/realmCache.js";
import { findRealmSearchById } from "../searchCache/realmSearchCach.js";
import { getRegionIdsMap } from "../regions/regionCache.js";
import { getOneAchFromAchCache } from "../achievements/achievesEmt.js";
import { enqueueJobQueueEntry } from "../charQueueCache/jobQueueCache.js";
import { CharacterCacheTTL } from "../../helpers/redis/connectRedis.js";
import findCharFromDatabase from "../../helpers/findCharFromDatabase.js";
import { getGameClass } from "../gameClasses/gameClassesCache.js";
import { getGameSpecializationByID } from "../gameSpecializations/gameSpecializationsCache.js";

export const CharCacheEmitter = new EventEmitter();
const CHAR_CACHE_EMMITER_MAX_LISTENERS = Number(process.env?.CHAR_CACHE_EMMITER_MAX_LISTENERS || "10");
CharCacheEmitter.setMaxListeners(CHAR_CACHE_EMMITER_MAX_LISTENERS);
const CHARACTER_CACHE_TTL_SECONDS = 3600;
const hashName = "";
const logModuleName = "Characters Cache";
/** @type {Map<string, Promise<CharacterRecord | 404 | null | undefined>>} */
const inFlightWorkerCharacters = new Map();

/**
 * @param {CharacterRetrievalParams} params
 * @returns {string | undefined}
 */
function resolveCharacterSearch(params) {
    const { server, realm, name, search } = params ?? {};
    return normalizeCharacterSearch(search) ?? buildCharSearch({ server, realm, name });
}

function isNumericRef(value) {
    return Number.isInteger(value) || (typeof value === "string" && /^\d+$/.test(value.trim()));
}

function selectGameClassFields(gameClass) {
    if (!gameClass) return null;

    return {
        _id: gameClass._id,
        name: gameClass.name,
        media: gameClass.media,
    };
}

function selectGameSpecializationFields(activeSpec) {
    if (!activeSpec) return null;

    return {
        _id: activeSpec._id,
        name: activeSpec.name,
        media: activeSpec.media,
        role: activeSpec.role,
    };
}

async function populateCharacterGameRefs(character) {
    if (!character || character === 404 || typeof character !== "object") return character;

    if (typeof character.populate === "function") {
        await character.populate([
            {
                path: "class",
                select: "_id name media",
            },
            {
                path: "activeSpec",
                select: "_id name media role",
            },
        ]);

        return character;
    }

    const classId = isNumericRef(character.class) ? Number(character.class) : undefined;
    const activeSpecId = isNumericRef(character.activeSpec) ? Number(character.activeSpec) : undefined;

    if (classId === undefined && activeSpecId === undefined) return character;

    const [gameClass, activeSpec] = await Promise.all([
        classId !== undefined ? getGameClass({ id: classId }).catch(() => null) : null,
        activeSpecId !== undefined ? getGameSpecializationByID(activeSpecId).catch(() => null) : null,
    ]);

    const populatedClass = selectGameClassFields(gameClass);
    if (populatedClass) character.class = populatedClass;

    const populatedActiveSpec = selectGameSpecializationFields(activeSpec);
    if (populatedActiveSpec) character.activeSpec = populatedActiveSpec;

    return character;
}

CharCacheEmitter.on("update", (msg) => console.log(`[${logModuleName}] ${msg}`));
CharCacheEmitter.on("error", (msg) => console.error(`[${logModuleName} ERROR] ${msg}`));
CharCacheEmitter.on("info", (msg) => console.info(`[${logModuleName} INFO] ${msg}`));
CharCacheEmitter.on("updateRequest", async (search) => {
    try {
        const exist = await getCache(search, hashName, CharacterCacheTTL);

        if (exist === null || !exist) return;
        const char = await shipCharById(exist.id);
        cacheOneCharacter(char);
    } catch (error) {
        console.warn(error);
    }
});

export async function cacheOneCharacter(charData) {
    // Epoch marks a minimal refresh that still needs a full fetch.
    if (charData?.updatedAt && new Date(charData.updatedAt).getTime() === 0) return null;

    let search = charData?.search;
    const _id = charData?._id;
    if (!_id || !search) {
        CharCacheEmitter.emit("error", `cacheOneCharacter invoked with bad params`);
        return null;
    }

    if (charData && search) {
        try {
            await setCache(
                search,
                charData.toObject(),
                hashName,
                CHARACTER_CACHE_TTL_SECONDS,
                CharacterCacheTTL,
            );
        } catch (error) {
            await setCache(
                search,
                charData,
                hashName,
                CHARACTER_CACHE_TTL_SECONDS,
                CharacterCacheTTL,
            );
        }
    }
}

/**
 * Normalize a character lookup and enqueue its worker job.
 *
 * @param {CharacterRetrievalParams} params
 * @returns {Promise<number | null>} Queue length, zero for a duplicate, or null on failure.
 */
export async function retrieveCharacter(params) {
    const { incChecks, incChechks, renewCache, minimal } = params ?? {};
    const nextSearch = resolveCharacterSearch(params);

    if (!nextSearch) {
        CharCacheEmitter.emit(
            "error",
            `retrieveCharacter invoked with bad params: ${JSON.stringify(params)}`,
        );
        return null;
    }

    return await enqueueJobQueueEntry(/** @satisfies {RetrieveCharacterQueueJob} */ ({
        type: "retrieveCharacter",
        data: {
            search: nextSearch,
            ...(typeof incChecks !== "undefined" ? { incChecks } : {}),
            ...(typeof incChechks !== "undefined" ? { incChechks } : {}),
            ...(typeof renewCache !== "undefined" ? { renewCache } : {}),
            ...(typeof minimal !== "undefined" ? { minimal } : {}),
        },
    }));
}

/**
 * Queue one worker-based character retrieval and wait for its published result once.
 *
 * @param {CharacterRetrievalParams} params
 * @param {CharacterRetrievalOptions} [options]
 * @returns {Promise<RetrieveCharacterResult | null>} Published character result, or null on timeout/enqueue failure.
 */
export async function retrieveCharacterViaWorker(
    params,
    { timeoutMs = 60000, signal, enqueue = true } = {},
) {
    const nextSearch = resolveCharacterSearch(params);

    if (!nextSearch) {
        CharCacheEmitter.emit(
            "error",
            `retrieveCharacterViaWorker invoked with bad params: ${JSON.stringify(params)}`,
        );
        return null;
    }

    if (enqueue) {
        const enqueued = await retrieveCharacter({
            ...params,
            search: nextSearch,
        });

        if (enqueued === null) {
            return null;
        }
    }

    const eventName = `retrieveCharacter:${nextSearch}`;
    const timeoutSignal = Number.isFinite(timeoutMs) ? AbortSignal.timeout(timeoutMs) : undefined;
    const waitSignal =
        signal && timeoutSignal
            ? AbortSignal.any([signal, timeoutSignal])
            : (signal ?? timeoutSignal);

    try {
        /** @type {RetrieveCharacterResult[]} */
        const [payload] = waitSignal
            ? await once(CharCacheEmitter, eventName, { signal: waitSignal })
            : await once(CharCacheEmitter, eventName);

        return payload ?? null;
    } catch (error) {
        if (error?.name === "AbortError") {
            if (signal?.aborted) {
                throw error;
            }

            return null;
        }

        throw error;
    }
}

/**
 * Resolve one character through the worker/pub-sub path while preserving the
 * direct `getCharacter()` return contract for REST callers.
 *
 * @param {string} server
 * @param {string} realm
 * @param {string} name
 * @param {boolean} [incChecks=true]
 * @param {boolean} [renewCache=false]
 * @param {boolean} [minimal=false]
 * @returns {Promise<CharacterRecord | 404 | null | undefined>}
 */
export async function getCharacterViaWorker(
    server,
    realm,
    name,
    incChecks = true,
    renewCache = false,
    minimal = false
) {
    const search = resolveCharacterSearch({ server, realm, name });

    if (!search) {
        CharCacheEmitter.emit(
            "error",
            `getCharacterViaWorker invoked with bad params: ${JSON.stringify({ server, realm, name })}`,
        );
        return null;
    }

    let inFlightPromise = inFlightWorkerCharacters.get(search);
    if (!inFlightPromise) {
        inFlightPromise = (async () => {
            try {
                const payload = await retrieveCharacterViaWorker(
                    {
                        server,
                        realm,
                        name,
                        search,
                        incChecks,
                        renewCache,
                        minimal
                    },
                    { timeoutMs: 60000 },
                );

                if (!payload || typeof payload !== "object") {
                    return undefined;
                }

                if (payload.status === 404) {
                    return 404;
                }

                if (payload.status !== 200) {
                    return undefined;
                }

                const { character } = payload;
                if (character === 404 || character === null || character === undefined) {
                    return 404;
                }

                return character;
            } catch (error) {
                console.warn(error);
                return undefined;
            } finally {
                inFlightWorkerCharacters.delete(search);
            }
        })();

        inFlightWorkerCharacters.set(search, inFlightPromise);
    }

    return await inFlightPromise;
}

/**
 * ! WARNING ! This function has to be used only in the workers drainer check the file to see other helpers to retrive a character
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
 * @param {boolean} [minimal=false] Fetch core data without caching it; leave the record due for a full refresh.
 * @returns {Promise<CharacterRecord | 404 | null | undefined>}
 * Returns a populated character record on success, `404` when the character or mapped realm
 * cannot be resolved, `null` when caching helpers reject invalid input, or `undefined` if the
 * request fails before a final value is produced.
 */
export async function getCharacter(
    server,
    realm,
    name,
    incChecks = true,
    renewCache = false,
    minimal = false,
) {
    let character;
    const fetchCharacter = minimal ? fetchMinimalCharacter : fetchData;

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
    const search = buildCharSearch({ server, realm, name });

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
                }, { timestamps: !minimal }).catch(console.error);
                character.checkedCount = character.checkedCount + 1;
                if (!minimal) cacheOneCharacter(character);
            }
            //check if the new data is not served
            const exist = character?.gear?.head?.pvpIlvl;
            if (!minimal && !exist) {
                renewCache = true;
                character = undefined;
            }
            // for (const [slot, value] of Object.entries(character.gear)) {
            //     if(slot == "tabard" || slot == "shirt") continue;
            //     if(!value.pvpILvl) {
            //         renewCache = true;
            //         character = undefined;
            //         break;
            //     }
            // }
            if (!renewCache) {
                character = await populateCharacterGameRefs(character);
                if (!minimal) await cacheOneCharacter(character);
                return character;
            }
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
        character = await findCharFromDatabase.byCredentials(server, realm, name);
        // if (!character) await Char.findOne({ search: search }); // >? not in variable

        const needsFullData = character && !minimal && (
            !character.gear?.head?.pvpIlvl || new Date(character.updatedAt).getTime() === 0
        );
        if (character && (isOlderThanHour(character) || renewCache === true || needsFullData)) {
            // Refresh stale/explicit requests, or fill details missing from a minimal record.

            const newData = await fetchCharacter(
                character.server,
                character.playerRealm.slug,
                character.name,
                character.checkedCount,
                renewCache || needsFullData,
            );
            let setter = undefined;
            if (newData?.code && newData?.data?.blizID) {
                character = await Char.findOne({ blizID: newData.data.blizID });
                if (newData.code === 202 || newData.code === 409 || (minimal && newData.code === 304))
                    setter = newData.data;
            } else {
                setter = newData;
            }

            if (setter) {
                if (minimal) setter.updatedAt = new Date(0);
                // Patch only fetched fields so minimal refreshes preserve detailed data.
                character = await Char.findByIdAndUpdate(
                    character._id,
                    { $set: setter },
                    { new: true, timestamps: !minimal },
                );
                if (minimal && character) {
                    await delCache(search, hashName, CharacterCacheTTL);
                    if (character.search !== search)
                        await delCache(character.search, hashName, CharacterCacheTTL);
                }
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
            character = await buildCharacter(server, realm, name, undefined, minimal);
            if (character === null) {
                await setCache(
                    search,
                    {
                        code: 404,
                        updatedAt: Date.now(),
                    },
                    hashName,
                    CHARACTER_CACHE_TTL_SECONDS,
                    CharacterCacheTTL,
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
            // console.warn(search + "No posts");
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
        await populateCharacterGameRefs(character);
        if (!minimal) await cacheOneCharacter(character);
        try {
            character = character.toObject();
        } catch (error) {}
    } catch (error) {
        console.warn(error);
    }
    return character;
}

async function getCharFromCacheBySearch(search) {
    const normalizedSearch = normalizeCharacterSearch(search);
    if (!normalizedSearch) {
        if (!search) {
            CharCacheEmitter.emit(
                "error",
                `getCharFromCacheBySearch has been invoked with bad params\n the function will now exit.`,
            );
            return null;
        }
        return null;
    }

    search = normalizedSearch;

    const result = await getCache(search, hashName, CharacterCacheTTL);
    if (result === null || !result) return null;
    return isOlderThanHour(result) ? undefined : result;
}
