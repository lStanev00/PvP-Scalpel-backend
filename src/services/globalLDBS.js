import { getCharacter } from "../caching/characters/charCache.js";
import global_titles_non_rel from "../caching/titles/globalTitles.js";
import dataGuard from "../helpers/blizFetch-helpers/dataGuard.js";
import helpFetch from "../helpers/blizFetch-helpers/endpointFetchesBliz.js";
import {
    createDefaultRatingResult,
    createEmptyRatingBracket,
    setHighestRatingRecord,
} from "../helpers/blizFetch-helpers/ratingHelpers.js";
import { fetchMinimalCharacter } from "../helpers/blizFetch.js";
import buildCharacter from "../helpers/buildCharacter.js";
import buildCharSearch from "../helpers/buildCharSearch.js";
import delCache from "../helpers/redis/deletersRedis.js";
import { CharacterCacheTTL } from "../helpers/redis/connectRedis.js";
import { delay } from "../helpers/startBGTask.js";
import threadBoot from "../helpers/threadBoot.js";
import BracketTops from "../Models/bracketTops/BracketTops.js";
import Char from "../Models/Chars.js";
import GameBrackets from "../Models/GameBrackets.js";
import Realm from "../Models/Realms.js";

await threadBoot(true);
const server = "eu";
const batchSize = 11;

const data = await helpFetch.fetchBlizzard(
    `https://${server}.api.blizzard.com/data/wow/pvp-season/${await helpFetch.getCurrentPvPSeasonIndex()}/pvp-leaderboard/?namespace=dynamic-${server}`,
);
const ldbList = data?.leaderboards;
// Hold shared ratings only while a missing character is being fetched and saved.
const pendingCharacterBuilds = new Map();
const charsToUpdate = new Map();
const ratingUpdates = new Map();

for (const { key, name } of ldbList) {
    const { href } = key;
    const startedAt = Date.now();
    let bracketName = name ?? href;
    console.info(`[Global LDBS] Leaderboard lookup started: ${bracketName}`);
    try {
        const bracketData = await helpFetch.fetchBlizzard(href).catch((e) => console.error(e));
        if (!Array.isArray(bracketData?.entries) || typeof bracketData?.name !== "string") continue;
        bracketName = bracketData.name;

        await BracketTops.formatBracketTops(bracketData); // save bdata;
        if (bracketData?.name.includes("overall")) continue;

        const entries = bracketData.entries;
        let bracket;

        if (bracketData?.name.includes("blitz")) {
            bracket = await GameBrackets.findById(2);
        } else if (bracketData?.name.includes("shuffle")) {
            bracket = await GameBrackets.findById(1);
        } else {
            bracket = await GameBrackets.findOne({ slug: bracketData.name.toLowerCase() });
        }

        for (let i = 0; i < entries.length; i += batchSize) {
            const currentBatch = entries.slice(i, i + batchSize);
            const lowElo = currentBatch.find(({ rating }) => rating < 1750);
            if (lowElo) break;
            await Promise.all(
                currentBatch.map(async ({ character, rating, season_match_statistics, tier }) => {
                    try {
                        const dock = {
                            server,
                            realm: character.realm.slug,
                            name: character.name,
                        };

                        const search = buildCharSearch(dock);
                        if (!search) return;

                        const blizID = Number(character.id);
                        let existingDoc = charsToUpdate.get(blizID);
                        if (!existingDoc && !pendingCharacterBuilds.has(blizID))
                            existingDoc = await Char.findOne({ blizID: character.id });

                        const bracketEntry = [
                            bracketData.name,
                            rating,
                            season_match_statistics,
                            tier,
                            character,
                        ];
                        return await handleLooseBracket(
                            existingDoc ? existingDoc : undefined,
                            bracketEntry,
                        );
                    } catch (error) {
                        console.warn(
                            `[Global LDBS] Failed to collect ${character?.name}:${character?.realm?.slug}:${server} in ${bracketData.name}:`,
                            error,
                        );
                    }
                }),
            );
        }
    } finally {
        console.info(
            `[Global LDBS] Leaderboard lookup finished: ${bracketName} (${Date.now() - startedAt}ms)`,
        );
    }
}

// Persist collected ratings, including later brackets for characters saved during collection.
if (charsToUpdate.size) {
    const updates = [...charsToUpdate.values()].map((character) => ({
        updateOne: {
            filter: { _id: character._id },
            update: ratingUpdates.get(Number(character.blizID)),
            timestamps: false,
        },
    }));
    try {
        await Char.bulkWrite(updates, { ordered: false });
    } catch (error) {
        console.warn("[Global LDBS] Failed to update existing character ratings:", error);
    } finally {
        // Unordered bulk writes may partially succeed even when they report an error.
        await Promise.all(
            [...charsToUpdate.values()]
                .filter((character) => character.search)
                .map((character) => delCache(character.search, "", CharacterCacheTTL)),
        );
    }
}

/**
 * @param {InstanceType<typeof Char> | undefined} charDoc - Existing character Mongoose document, if found.
 * @param {[
 *   bracketName: string,
 *   rating: number,
 *   seasonStats: { played: number, won: number, lost: number },
 *   tier: { id: number, key: { href: string } },
 *   character: { id: number, name: string, realm: { id: number, slug: string, key: { href: string } } }
 * ]} bracketEntry - Bracket name, rating, season statistics, tier, faction, and character.
 */
async function handleLooseBracket(charDoc, [bracketName, rating, seasonStats, tier, character]) {
    const logTag = `[Global LDBS] ${character.name}:${character.realm.slug}:${server} (${character.id}) [${bracketName}]`;

    // const charProfile = await helpFetch.getCharProfile(server, character.realm.slug, character.name);
    const realmDoc = await Realm.findById(character.realm.id).select("name").lean();
    const realmName =
        typeof realmDoc?.name === "string"
            ? realmDoc.name
            : (realmDoc?.name?.en_GB ?? realmDoc?.name?.en_US);
    if (!realmName) throw new Error(`Realm name missing in MongoDB for ${character.realm.id}`);

    // Reuse shared titles, refreshing definitions that are at least 50 days old.
    const cachedTitle = await global_titles_non_rel.getOne({ id: tier.id, href: tier.key.href });
    if (!cachedTitle) throw new Error("title failed");
    const title = { name: cachedTitle.name, media: cachedTitle.media };

    // Another entry may have finished building this character during the lookups above.
    charDoc ??= charsToUpdate.get(Number(character.id));
    // Initialize missing brackets through the Mongoose Map before updating them.
    if (charDoc) {
        const guardDataMock = {
            blizID: character.id,
            name: character.name,
            server,
            playerRealm: {
                name: realmName,
                slug: character.realm.slug,
            },
            lastLogin: 0,
            class: charDoc["class"],
            race: charDoc.race,
            activeSpec: charDoc.activeSpec,
        };

        const guard = await dataGuard(guardDataMock, true);
        if (guard === 409 || guard === 202) {
            await delay(2500);
            charDoc = await Char.findById(charDoc._id);
        }

        queueRatingUpdate(charDoc, bracketName, rating, seasonStats, title);
    } else {
        const blizID = Number(character.id);
        let placeholder = pendingCharacterBuilds.get(blizID);
        const needsBuild = !placeholder;
        if (!placeholder)
            placeholder = { rating: createDefaultRatingResult(), brackets: new Set() };

        // Merge every leaderboard bracket into the same rating object, including while fetching.
        placeholder.rating[bracketName] ??= createEmptyRatingBracket();
        const bracketRating = placeholder.rating[bracketName];
        bracketRating.currentSeason.rating = rating;
        bracketRating.currentSeason.seasonMatchStatistics = seasonStats;
        bracketRating.currentSeason.title = title;
        setHighestRatingRecord(placeholder.rating, bracketName, rating);
        placeholder.brackets.add(bracketName);

        if (needsBuild) {
            // Reserve this ID before awaiting so concurrent entries cannot start another build.
            pendingCharacterBuilds.set(blizID, placeholder);
            try {
                const fetched = await fetchMinimalCharacter(
                    server,
                    character.realm.slug,
                    character.name,
                    undefined,
                    true,
                    undefined,
                    placeholder.rating,
                );
                const fetchedCharacter = fetched?.data ?? fetched;
                if (!fetchedCharacter || Number(fetchedCharacter.blizID) !== blizID) {
                    if (!fetchedCharacter?.blizID && !fetched?.code) return;
                    console.warn(
                        `${logTag} Build skipped: fetched ID=${fetchedCharacter?.blizID ?? "none"}, code=${fetched?.code ?? "none"}`,
                    );
                    return;
                }

                const payload = { ...fetchedCharacter, rating: placeholder.rating };
                const saved = await buildCharacter(
                    payload.server,
                    payload.playerRealm.slug,
                    payload.name,
                    undefined,
                    true,
                    payload,
                );
                if (Number(saved?.blizID) !== blizID) {
                    console.warn(`${logTag} Could not save character: returned Blizzard ID=${saved?.blizID ?? "none"}.`);
                    return;
                }

                // Include brackets received during the save and preserve higher database records.
                for (const collectedBracket of placeholder.brackets) {
                    const { currentSeason, record } = placeholder.rating[collectedBracket];
                    queueRatingUpdate(
                        saved,
                        collectedBracket,
                        currentSeason.rating,
                        currentSeason.seasonMatchStatistics,
                        currentSeason.title,
                        record,
                    );
                }
            } finally {
                pendingCharacterBuilds.delete(blizID);
            }
        }
    }
}

/** Apply an observed bracket and queue its fields for the final bulk update. */
function queueRatingUpdate(charDoc, bracketName, rating, seasonStats, title, record = rating) {
    if (!charDoc.rating.has(bracketName)) {
        charDoc.rating.set(bracketName, { currentSeason: {} });
    }
    const bracketRating = charDoc.rating.get(bracketName);
    bracketRating.currentSeason.rating = rating;
    bracketRating.currentSeason.seasonMatchStatistics = seasonStats;
    bracketRating.currentSeason.title = title;
    bracketRating.record = Math.max(bracketRating.record ?? 0, record ?? 0, rating);
    charDoc.rating.set(bracketName, bracketRating);

    const blizID = Number(charDoc.blizID);
    const update = ratingUpdates.get(blizID) ?? { $set: {}, $max: {} };
    const path = `rating.${bracketName}`;
    // Write only observed fields; leave other brackets and weekly statistics untouched.
    update.$set[`${path}.currentSeason.rating`] = rating;
    update.$set[`${path}.currentSeason.seasonMatchStatistics`] = seasonStats;
    update.$set[`${path}.currentSeason.title`] = title;
    update.$max[`${path}.record`] = Math.max(
        update.$max[`${path}.record`] ?? 0,
        bracketRating.record,
    );
    ratingUpdates.set(blizID, update);
    charsToUpdate.set(blizID, charDoc);
    return bracketRating;
}
