import dotenv from "dotenv";
import Char from "../Models/Chars.js";
import fetchData from "../helpers/blizFetch.js";
import helpFetch from "../helpers/blizFetch-helpers/endpointFetchesBliz.js";
import Service from "../Models/Services.js";
import buildCharacter from "../helpers/buildCharacter.js";
import { delay } from "../helpers/startBGTask.js";
import updateWeeklyLadder from "./UpdateWeeklyLadder.js";
import { CharCacheEmitter } from "../caching/characters/charCache.js";
dotenv.config({ path: "../../../../.env" });

// PLEASE NOTE! Blizzard API have 36,000 requests per hour at a rate of 100 requests per second LIMIT!

// Blizzard API Configuration
const GUILD_REALM = "chamber-of-aspects"; // Guild's realm slug
const GUILD_NAME = "pvp-scalpel"; // Guild name slugified

export const guildRanks = {
    0: "Warlord",
    1: "Council",
    2: "Vanguard",
    3: "Envoy",
    4: "Champion",
    5: "Gladiator",
    6: "Slayer",
    7: "Striker",
    8: "Alt/Twink",
    9: "Initiate",
};

async function findCharFromDatabase(server, realm, name) {
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

export async function updateGuildMembersData() {
    const now = new Date();
    const fullUpdate = await checkIfShouldUpdateFull();

    const dbaseKnownEntries = await Char.find({ guildMember: true }).lean();

    const guildRoster = await helpFetch.fetchBlizzard(
        `https://eu.api.blizzard.com/data/wow/guild/${GUILD_REALM}/${GUILD_NAME}/roster?namespace=profile-eu`
    );

    if (!guildRoster || !guildRoster.members) {
        throw new Error("[PatchPvP] Failed to fetch guild roster.");
    }

    const members = guildRoster.members;

    for (const dbaseEntry of dbaseKnownEntries) {
        const blizID = dbaseEntry?.blizID;
        if (!blizID) continue;

        const exist = members.find((entry) => entry.character.id == blizID);
        if (exist) continue;
        // console.info(dbaseEntry.name);
        try {
            const charOut = await Char.findByIdAndUpdate(
                dbaseEntry._id,
                {
                    $set: {
                        guildMember: false,
                    },
                    $unset: {
                        guildInsight: "",
                    },
                },
                { new: true }
            );
            console.info(`Character: ${charOut.name}'s no longer a guild member`);
        } catch (error) {
            console.error(error);
        }
    }

    let delayMS = 500;
    const updateDoc = {
        $set: { running: false },
        $push: {},
    };

    for (const member of members) {
        // start the loop for the members list
        const server = "eu";
        const realm = member?.character.realm?.slug;
        const name = member?.character.name;
        let character = await findCharFromDatabase(server, realm, name);
        if (!character) character = await buildCharacter(server, realm, name, member?.rank);
        if (!character) continue;
        let change = false;
        if (!character.guildInsight) {
            // check if there's a missing rank
            character.guildInsight = {
                rank: guildRanks?.[member?.rank] || "Initiate",
                rankNumber: member?.rank || 0,
            };
            change = true;
        }
        if (!character.guildMember) {
            character.guildMember = true;
            change = true;
        }
        if (character.guildName !== "PvP Scalpel") {
            character.guildName = "PvP Scalpel";
            change = true;
        }
        if (change) {
            try {
                character = await character.save();
            } catch (error) {
                if (character) {
                    console.error("Character:", {
                        name: character.name,
                        realm: character?.playerRealm?.slug,
                        id: character?._id,
                        blizID: character?.blizID,
                    });
                }
            }
        }

        await delay(delayMS);

        if (fullUpdate) {
            if (!character) {
                console.warn(
                    `[PatchPvP] The character update failed with credentials:\n${server} ${realm} ${name}`
                );
            } else {
                const checkedCount = character.checkedCount;

                try {
                    const isOlderThanDay =
                        new Date(character.updatedAt) < new Date(Date.now() - 24 * 60 * 60 * 1000);
                    const updatedData = await fetchData(
                        server,
                        realm,
                        name,
                        undefined,
                        isOlderThanDay
                    );
                    if (updatedData === false) continue;
                    let setter = undefined;
                    if (updatedData?.code && updatedData?.data?.blizID) {
                        character = await Char.findOne({ blizID: updatedData.data.blizID });
                        if (updatedData.code === 202) setter = updatedData?.data;
                    } else {
                        if (updatedData.data) setter = updatedData.data;
                        else setter = updatedData;
                    }

                    if (
                        setter ||
                        !character.guildInsight ||
                        character?.guildInsight.rank === null ||
                        character?.guildInsight.rank === undefined
                    ) {
                        if(setter === null || !setter) setter = {};
                        setter.checkedCount = checkedCount;
                        setter.guildInsight = {
                            rank: guildRanks?.[member?.rank] || "Initiate",
                            rankNumber: member?.rank || 0,
                        };
                        setter.guildMember = true;
                        setter.guildName = "PvP Scalpel";
                        for (const [key, value] of Object.entries(setter)) {
                            if (character?.[key] && value) character[key] = value;
                        }

                        character = await Char.findByIdAndUpdate(
                            character._id,
                            { $set: setter },
                            { new: true }
                        );
                    }
                } catch (error) {
                    console.warn(`Error at non full update in guild patch =>\n=>    ${error}`);
                }
            }
            continue;
        } else {
            try {
                const PvPData = await helpFetch.getRating(
                    undefined,
                    undefined,
                    server,
                    realm,
                    name
                );
                character = await Char.findByIdAndUpdate(
                    character._id,
                    {
                        rating: PvPData,
                    },
                    { timestamps: false, new: true }
                );
            } catch (error) {
                console.warn(error);
            }
        }

        if (character._id) CharCacheEmitter.emit("updateRequest", character?.search);
    }

    const endNow = new Date();
    const runtimeMS = endNow.getTime() - now.getTime();

    try {
        if (fullUpdate) {
            updateDoc.$set.lastRun = endNow;
        }
        updateDoc.$push.msRecords = runtimeMS;

        const serviceUpdate = await Service.findOneAndUpdate({ service: "PatchPvP" }, updateDoc, {
            new: true,
        });
        if (fullUpdate)
            console.info(
                `[PatchPvP] Full Update succeed: ${now.toLocaleDateString()} ${endNow.toLocaleTimeString()} `
            );
        await updateWeeklyLadder();
        return serviceUpdate;
    } catch (error) {
        console.warn(error);
        return null;
    }
}

async function checkIfShouldUpdateFull() {
    const sixHours = 6 * 60 * 60 * 1000;
    const nowMS = new Date().getTime();
    let serviceData = undefined;

    try {
        serviceData = await Service.findOne({ service: "PatchPvP" });
    } catch (error) {}

    if (!serviceData) {
        try {
            const newService = new Service({
                service: "PatchPvP",
                running: true,
            });

            await newService.save();
            serviceData = await Service.findOne({ service: "PatchPvP" });
        } catch (error) {
            console.warn(error);
        }
    }

    const lastRun = serviceData?.lastRun;

    if (lastRun === null || !lastRun) return true;

    const lastMS = lastRun ? lastRun.getTime() : 0;

    return nowMS - lastMS >= sixHours;
}
