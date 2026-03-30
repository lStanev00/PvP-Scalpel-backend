import { CharCacheEmitter } from "../../caching/characters/charCache.js";
import { enqueueJobQueueEntry } from "../../caching/charQueueCache/jobQueueCache.js";
import { getGameBracketByID } from "../../caching/gameBrackets/gameBracketsCache.js";
import { getGameSpecializationByID } from "../../caching/gameSpecializations/gameSpecializationsCache.js";
import { wsResponse } from "../helpers/wsResponseHelpers.js";
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
        }, 30000);

        CharCacheEmitter.once(eventName, onResult);
        listenerCleanup.add(cleanup);
    }

    async function processEntries(entries) {
        const jobBuild = {
            type : "bulkRetrieveCharacter",
            data: []
        }
        const buildEntryJob = (searchString) => {
            return {
                search: searchString,
                incChecks: false,
            }
        }
        for (const [name, realm, serverAndIsSoloCheckNeeded] of entries.map((x) => x.split(":"))) {
            let server;
            let spec;

            if (bracketObj.isSolo) {
                const match = serverAndIsSoloCheckNeeded.match(/^([a-z]+)\((\d+)\)$/i);
                if (match) {
                    server = match[1];
                    spec = await getGameSpecializationByID(match[2]);
                } else {
                    console.warn(
                        `[QueueCheckHandler.js] server or spec is failing to match line 39\n match = ${match} `,
                    );
                }
            } else {
                server = serverAndIsSoloCheckNeeded;
            }


            try {
                const initSearch = [name, realm, serverAndIsSoloCheckNeeded].join(":");
                const legitSearch = [name,realm, server].join(":");
                jobBuild.data.push(buildEntryJob(legitSearch));
                registerCharacterResultListener(legitSearch, initSearch, spec);

            } catch (error) {
                console.warn(error);
            }
        }
        await enqueueJobQueueEntry(jobBuild);
    }
    await processEntries(data)
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