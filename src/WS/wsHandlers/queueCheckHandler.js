import { getCharacter } from "../../caching/characters/charCache.js";
import { getGameBracketByID } from "../../caching/gameBrackets/gameBracketsCache.js";
import { getGameSpecializationByID } from "../../caching/gameSpecializations/gameSpecializationsCache.js";
import helpFetch from "../../helpers/blizFetch-helpers/endpointFetchesBliz.js";
import { wsResponse } from "../helpers/wsResponseHelpers.js";

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

    if (data.length === 0 || rawData.length === 0) {
        wsResponse(ws, "error", { at: Date.now() });
        return;
    }
    const bracketObj = await getGameBracketByID(data.shift());
    wsResponse(ws, "bracketObj", bracketObj);

    // 2
    // |Slothx:ravencrest:eu(251)
    // |agnarkarma:archimonde:eu(270)
    // |Drdx:stormscale:eu(64)
    // |Sowiluj:silvermoon:eu(102)
    // |Beowullf:spinebreaker:eu(72)
    // |Мотумбатор:свежевательдуш:eu(267)
    // |Lychezar:chamber-of-aspects:eu(73)
    // |Hetma:burning-legion:eu(1468)

    async function processEntries(entries) {
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
                const char = await getCharacter(server, realm, name);

                if (char === 404 || char === null || char === undefined) {
                    wsResponse(ws, "charData", {
                        initSearch,
                        data: undefined,
                    });
                    continue;
                }

                if (!char?._id) {
                    wsResponse(ws, "charData", {
                        initSearch,
                        data: undefined,
                    });
                    continue;
                }

                wsResponse(ws, "charData", {
                    initSearch,
                    searchSpecRequested: spec ?? null,
                    data: {
                        ...char,
                    },
                });

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
            } catch (error) {
                console.warn(error);
            }
        }
    }

    const midpoint = Math.ceil(data.length / 2);
    const firstHalf = data.slice(0, midpoint);
    const secondHalf = data.slice(midpoint);

    await Promise.all([processEntries(firstHalf), processEntries(secondHalf)]);
    ws.close(1000, "Done");
}
