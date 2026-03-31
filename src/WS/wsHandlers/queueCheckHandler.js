import { CharCacheEmitter } from "../../caching/characters/charCache.js";
import { enqueueJobQueueEntry } from "../../caching/charQueueCache/jobQueueCache.js";
import { getGameBracketByID } from "../../caching/gameBrackets/gameBracketsCache.js";
import { getGameSpecializationByID } from "../../caching/gameSpecializations/gameSpecializationsCache.js";
import buildCharSearch from "../../helpers/buildCharSearch.js";
import { wsMessage, wsResponse } from "../helpers/wsResponseHelpers.js";
// import helpFetch from "../../helpers/blizFetch-helpers/endpointFetchesBliz.js";

/**
 * Preserve the current partial queueCheck flow without inventing new behavior.
 *
 * @param {{ send: (payload: string) => unknown }} ws
 * @param {{ data?: unknown }} msg
 * @returns {Promise<void>}
 */
export default async function queueCheckHandler(ws, msg) {
    const rawData = typeof msg?.data === "string" ? msg.data : "";
    const data = rawData.split("|");
    const listenerCleanup = new Set();

    const clearPendingListeners = () => {
        for (const cleanup of listenerCleanup) cleanup();
        listenerCleanup.clear();
    };

    ws.once("close", clearPendingListeners);

    if (data.length === 0 || rawData.length === 0) {
        wsResponse(ws, "error", { at: Date.now() });
        return;
    }
    const bracketObj = await getGameBracketByID(data.shift());
    wsResponse(ws, "bracketObj", bracketObj);
    wsResponse(ws, "playerIDs", data);

    // 2
    // |Slothx:ravencrest:eu(251)
    // |agnarkarma:archimonde:eu(270)
    // |Drdx:stormscale:eu(64)
    // |Sowiluj:silvermoon:eu(102)
    // |Beowullf:spinebreaker:eu(72)
    // |Мотумбатор:свежевательдуш:eu(267)
    // |Lychezar:chamber-of-aspects:eu(73)
    // |Hetma:burning-legion:eu(1468)

    function rejectEntry(rawEntry, reason) {
        const rejectedEntry = {
            entry: rawEntry,
            reason,
        };

        console.warn("[QueueCheckHandler] Rejected queueCheck entry", rejectedEntry);
        return rejectedEntry;
    }

    async function parseQueueEntry(rawEntry) {
        if (typeof rawEntry !== "string") {
            return { rejected: rejectEntry(String(rawEntry), "entry is not a string") };
        }

        const trimmedEntry = rawEntry.trim();
        if (trimmedEntry.length === 0) {
            return { rejected: rejectEntry(rawEntry, "entry is empty") };
        }

        const entryParts = trimmedEntry.split(":");
        if (entryParts.length !== 3) {
            return { rejected: rejectEntry(trimmedEntry, "entry must have exactly 3 segments") };
        }

        const [name, realm, serverOrSoloSegment] = entryParts;
        let server = serverOrSoloSegment;
        let spec = null;

        if (bracketObj.isSolo) {
            const match = serverOrSoloSegment.match(/^([a-z-]+)\((\d+)\)$/i);

            if (!match) {
                return {
                    rejected: rejectEntry(
                        trimmedEntry,
                        "solo entry must use server(specId) format",
                    ),
                };
            }

            server = match[1];
            spec = await getGameSpecializationByID(match[2]);
        }

        const search = buildCharSearch(server, realm, name);
        if (!search) {
            return { rejected: rejectEntry(trimmedEntry, "entry contains empty or invalid search parts") };
        }

        return {
            parsed: {
                initSearch: trimmedEntry,
                search,
                spec,
            },
        };
    }

    function registerCharacterResultListener(search, initSearch, spec) {
        const eventName = `retrieveCharacter:${search}`;
        const onResult = (msg) => {
            clearTimeout(timeoutId);
            listenerCleanup.delete(cleanup);

            const { character } = msg;

            if (character === 404 || character === null || character === undefined || !character?._id) {
                wsResponse(ws, "charData", {
                    initSearch,
                    data: undefined,
                });
                return;
            }

            wsResponse(ws, "charData", {
                initSearch,
                searchSpecRequested: spec ?? null,
                data: {
                    ...character,
                },
            });
        };

        const cleanup = () => {
            clearTimeout(timeoutId);
            CharCacheEmitter.off(eventName, onResult);
        };

        const timeoutId = setTimeout(() => {
            cleanup();
            listenerCleanup.delete(cleanup);
            wsResponse(ws, "charData", {
                initSearch,
                data: undefined,
            });
        }, 60000);

        CharCacheEmitter.once(eventName, onResult);
        listenerCleanup.add(cleanup);
    }

    async function processEntries(entries) {
        const jobBuild = {
            type: "bulkRetrieveCharacter",
            data: [],
        };
        const rejectedEntries = [];
        const buildEntryJob = (searchString) => {
            return {
                search: searchString,
                incChecks: false,
            }

        };

        for (const rawEntry of entries) {
            try {
                const { parsed, rejected } = await parseQueueEntry(rawEntry);

                if (rejected) {
                    rejectedEntries.push(rejected);
                    continue;
                }

                jobBuild.data.push(buildEntryJob(parsed.search));
                registerCharacterResultListener(parsed.search, parsed.initSearch, parsed.spec);
            } catch (error) {
                console.warn(error);
                rejectedEntries.push(rejectEntry(String(rawEntry), "entry failed during parsing"));
            }
        }

        if (rejectedEntries.length !== 0) {
            wsResponse(ws, "queueCheckRejected", {
                rejectedEntries,
                rejectedCount: rejectedEntries.length,
                queuedCount: jobBuild.data.length,
            });
        }

        if (jobBuild.data.length === 0) {
            wsMessage(ws, "error", "No valid queueCheck entries were found.", {
                at: Date.now(),
                rejectedEntries,
            });
            return;
        }

        await enqueueJobQueueEntry(jobBuild);
    }

    await processEntries(data);
    // ws.close(1000, "Done");
}
                // to be optimized this ise demo version atm
                // const char = await helpFetch.getCharProfile(server, realm, name);
                // if (!char || !char?.id) {
                //     wsResponse(ws, "charData", {
                //         initSearch,
                //         data: undefined,
                //     });

                //     continue;
                // }

                // const currentSeasonIndex = await helpFetch.getCurrentPvPSeasonIndex();

                // const result = {
                //     name: char.name,
                //     server,
                //     playerRealm: {
                //         name: char.realm.name,
                //         slug: char.realm.slug,
                //     },
                //     blizID: char.id,
                //     level: Number(char.level),
                //     faction: char.faction.name,
                //     lastLogin: char.last_login_timestamp,
                //     achieves: { points: Number(char.achievement_points) },
                //     class: { name: char.character_class.name },
                //     race: char.race.name,
                //     activeSpec: { name: char.active_spec.name },
                //     guildName: char?.guild?.name,
                //     guildMember: char?.guild?.name == "PvP Scalpel" ? true : false,
                // };
