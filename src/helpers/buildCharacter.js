import { insertOneCharSearchMap } from "../caching/searchCache/charSearchCache.js";
import Char from "../Models/Chars.js";
import fetchData from "./blizFetch.js";
import buildCharSearch from "./buildCharSearch.js";
import convertSearch from "./convertSearch.js";
import delCache from "./redis/deletersRedis.js";
import getCache from "./redis/getterRedis.js";
import setCache from "./redis/setterRedis.js";
import { delay } from "./startBGTask.js";


const guildRanks = {
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

/**
 * Redis hash used as a lightweight lock registry for in-progress character builds.
 *
 * @type {string}
 */
const hashName = "buildingEntries";

/**
 * Builds a character entry when it is missing and prevents duplicate concurrent builds
 * for the same character key.
 *
 * If another request is already creating the same character, this function waits for
 * the in-progress cache marker to clear and then returns the MongoDB entry that was
 * just created. Otherwise it fetches Blizzard data, optionally adds guild rank
 * metadata, stores the new document, updates the character search cache, and clears
 * the build lock.
 *
 * @param {string} server - Region/server identifier used for the Blizzard and Mongo lookups.
 * @param {string} realm - Realm slug used to resolve the character.
 * @param {string} name - Character name.
 * @param {number} [memberRankNumber] - Optional guild rank index used to populate `guildInsight`.
 * @returns {Promise<object|null>} The existing or newly saved character record, or `null` when the character cannot be built.
 */

// If no mongo entry try updating the db with a new one and send it
// in case that the character/player renamed we need a check if the blizard ID already exist
// in the database and make a defencive if state to cover the edge case because we evaluate
// to have a duplication key sicne blizID is indexed and unique as it has to be 

const returnChar = async (key, blizID = undefined) => {
    const [name, realm, server] = convertSearch(key) ?? [];

    try {
        let character = await Char.findOne(
            blizID === undefined
                ? {
                      name: new RegExp(`^${name}$`, "i"),
                      "playerRealm.slug": realm,
                      server: server,
                  }
                : { blizID: blizID },
        );
        return character;
    } catch (error) {
        console.warn(error);
    }
    return undefined;
};

export default async function buildCharacter(server, realm, name, memberRankNumber = undefined) {
    let character;
    // const key = `${server + realm + name}`;
    const key = buildCharSearch({ server, realm, name })
    const doesEntryAlreadyBuild = await getCache(key, hashName);
    if (doesEntryAlreadyBuild && doesEntryAlreadyBuild !== null) {

        while (true) {

            await delay(200);
            const exist = await getCache(key, hashName);
            if(!exist || exist === null) break;
            
        };
        return await returnChar(key);
    }

    await setCache(key, true, hashName);

    character = await fetchData(server, realm, name);
    if (character?.status === 409 && character?.data?.blizID) {
        try {
            const setter = character.data;
            const exist = await Char.findOne({ blizID: setter.blizID });
            for (const [key, value] of Object.entries(setter)) exist[key] = value;

            exist.save();
            character = exist.toObject();
            console.info(
                `buildCharacter just pathced one character due to rename\N OLD SEARCH: ${key}\nNEW SEARCH: ${exist.search}`,
            );

            await delCache(key, hashName);
            return await returnChar("", exist.blizID);
        } catch (error) {
            console.warn(
                "Check this case the service tried to build upon an existing bliz id entry error on next line\n" +
                    error,
            );
        }
    }
    if (character.data) character = character.data;
    if (character == false) {
        console.log("Character missing: ", key);
        await delCache(key, hashName);
        return null
    }
    try {
        character.checkedCount = 0;
        if(memberRankNumber) {
            character.guildInsight = {
                rank: guildRanks?.[memberRankNumber] || "Initiate",
                rankNumber: memberRankNumber || 0,
            }
        }
        const newCharacter = new Char(character);
        const savedChar = await newCharacter.save();
        
        await delCache(key, hashName);

        insertOneCharSearchMap(savedChar);
        return await returnChar(key);
        
    } catch (error) {
        console.log(error)
        return null;
    }
}
