import { retrieveCharacterViaWorker } from "../../caching/characters/charCache.js";
import { enqueueJobQueueEntry } from "../../caching/charQueueCache/jobQueueCache.js";
import { getGameBracketByID } from "../../caching/gameBrackets/gameBracketsCache.js";
import { getGameSpecializationByID } from "../../caching/gameSpecializations/gameSpecializationsCache.js";
import buildCharSearch from "../../helpers/buildCharSearch.js";
import { wsMessage, wsResponse } from "../helpers/wsResponseHelpers.js";
// import helpFetch from "../../helpers/blizFetch-helpers/endpointFetchesBliz.js";
const matchRegex = /(?<bracketID>\d)\[(?<team1String>.+)\]\[(?<team2String>.+)\]/gm;

/**
 * Preserve the current partial queueCheck flow without inventing new behavior.
 *
 * @param {{ send: (payload: string) => unknown }} ws
 * @param {{ data?: unknown }} msg
 * @returns {Promise<void>}
 */
export default async function queueCheckHandler(ws, msg) {
    const rawData = typeof msg?.data === "string" ? msg.data : "";
    if (rawData.length === 0) {
        wsResponse(ws, "error", { at: Date.now() });
        return;
    }
    const requestController = new AbortController();

    matchRegex.lastIndex = 0;
    const match = matchRegex.exec(rawData);

    const {bracketID, team1String, team2String} = match?.groups;

    if (match && (!bracketID || !team1String || !team2String)) {
        wsMessage(ws, "error", "Invalid queueCheck group payload.", {
            at: Date.now(),
            rawData,
        });
        return;
    }

    const team1 = team1String.split("|");
    const team2 = team2String.split("|");

    ws.once("close", () => requestController.abort());

    const bracketObj = await getGameBracketByID(bracketID);
    wsResponse(ws, "bracketObj", bracketObj);
    wsResponse(ws, "team1IDs", team1);
    wsResponse(ws, "team2IDs", team2);

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

    function requestCharacterResult(search, initSearch, spec) {
        void retrieveCharacterViaWorker(
            { search },
            { timeoutMs: 60000, signal: requestController.signal, enqueue: false },
        )
            .then((msg) => {
                if (requestController.signal.aborted) return;

                const { character } = msg ?? {};

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
            })
            .catch((error) => {
                if (error?.name === "AbortError") return;

                console.warn(error);
                if (requestController.signal.aborted) return;

                wsResponse(ws, "charData", {
                    initSearch,
                    data: undefined,
                });
            });
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
                requestCharacterResult(parsed.search, parsed.initSearch, parsed.spec);
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

    await processEntries([...team1, ...team2]);

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

// 2[Adventureman:argent-dawn:eu(254)|Oifik:frostmane:eu(1480)|Zamruka:ravenholdt:eu(261)|Калмычка:gordunni:eu(256)|Akemi:eredar:eu(252)|Øéyx:ravencrest:eu(1468)|Lychezar:chamber-of-aspects:eu(73)|Снюсловер:gordunni:eu(102)][Aylanur:ravencrest:eu(103)|Balúr:thrall:eu(264)|Canhalli:the-maelstrom:eu(270)|Causality:sylvanas:eu(577)|Ledva:drakthul:eu(70)|Onlylock:ragnaros:eu(267)|Tyranorde:hyjal:eu(73)|Zaijko:stormscale:eu(251)]
