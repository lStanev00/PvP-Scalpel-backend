import buildCharSearch from "../../helpers/buildCharSearch.js";
import { getGameBracketByBlizID, storeGameBrackets } from "../../caching/gameBrackets/gameBracketsCache.js";
import { getGameClass } from "../../caching/gameClasses/gameClassesCache.js";
import {
    getGameSpecializationByName,
    getGameSpecializations,
} from "../../caching/gameSpecializations/gameSpecializationsCache.js";
import { searchRegionFromMapBySlug } from "../../caching/regions/regionCache.js";
import GameBrackets from "../GameBrackets.js";
import BracketTops from "./BracketTops.js";
import slugify from "../../helpers/slugify.js";

async function upsertBracketTop(payload) {
    await BracketTops.updateOne(
        { _id: payload._id },
        { $set: payload },
        { upsert: true, runValidators: true },
    );
}

export default async function formatBracketTops(blizResponse) {
    // This function recives a raw blizzard response and map the data then save it to dbase with season tag
    // the tag looks like - bracketSlug:seasonId:serverSlug

    const serverSlug = blizResponse?._links?.self?.href
        ?.split(".api.")?.[0]
        ?.replace("https://", "")
        ?.trim()
        ?.toLowerCase();

    const regionDoc = (await searchRegionFromMapBySlug(serverSlug))[1];
    const seasonID = Number(blizResponse.season.id) || null;
    const blizzardBracketID = Number(blizResponse.bracket.id);
    let gameBracket = await getGameBracketByBlizID(blizResponse.bracket.id);
    if (gameBracket === null) {
        let bSlug = blizResponse.name.toLowerCase();
        if (bSlug.startsWith("shuffle") || bSlug.startsWith("blitz")) {
            bSlug = (bSlug.split("-"))[0];
        }
        try {
            const doc = await GameBrackets.findOne({slug: bSlug});
            if (doc) {
                doc.blizID = blizResponse.bracket.id;
                await doc.save();
                await storeGameBrackets();
            }
        } catch (error) {
            console.warn(error);
        }
        gameBracket = await getGameBracketByBlizID(blizResponse.bracket.id);
    }
    let BracketTopsId;

    const characters = blizResponse.entries.map((entry) => {
        let { name, realm } = entry.character;
        realm = realm.slug;

        const search = buildCharSearch({ name, realm, server: serverSlug });
        const rating = Number(entry.rating);
        const rank = Number(entry.rank);
        return {
            search,
            rating,
            rank,
        };
    });
    if (gameBracket === null) {
        console.warn(
            [
                `Game Bracket not found at BracketTopsSchema.statics.formatQueueEntry // mem dump ...`,
                `bracketName: ${JSON.stringify(blizResponse.name, null, 4)}`,
                `season: ${JSON.stringify(seasonID, null, 4)}`,
                `serverSlug: ${JSON.stringify(serverSlug, null, 4)}`,
                `bracket: ${JSON.stringify(blizResponse.bracket, null, 4)}`,
            ].join("\n"),
        );
        return null;
    }
    if (!gameBracket.isSolo) {
        // 2v2, 3v3, rbg
        if (!gameBracket.slug) {
            console.warn(
                [
                    `Game Bracket slug not found at BracketTopsSchema.statics.formatQueueEntry // mem dump ...`,
                    `bracketName: ${JSON.stringify(blizResponse.name, null, 4)}`,
                    `season: ${JSON.stringify(seasonID, null, 4)}`,
                    `gameBracket: ${JSON.stringify(gameBracket, null, 4)}`,
                ].join("\n"),
            );
            return null;
        }

        if (
            (gameBracket.blizID === undefined || gameBracket.blizID === null) &&
            Number.isFinite(blizzardBracketID)
        ) {
            await GameBrackets.updateOne(
                { _id: gameBracket._id },
                { $set: { blizID: blizzardBracketID } },
            );
        }

        BracketTopsId = [gameBracket.slug, seasonID, serverSlug].join(":");

        await upsertBracketTop({
            _id: BracketTopsId,
            region: regionDoc._id,
            season: seasonID,
            bracket: blizzardBracketID,
            characters,
        });
    } else {
        // blitz, soloShuffle
        const [_, classSlug, ...specSlugParts] = blizResponse.name.split("-");

        if (classSlug.includes("overall")) {
            console.info(blizResponse.entries.length);
            return;
        }

        const specSlug = specSlugParts.join("-");

        const classDoc = await getGameClass({ name: classSlug });
        let specDoc = await getGameSpecializationByName(specSlug.replaceAll("-", " "));

        if (classDoc?._id && (!specDoc?._id || Number(specDoc.relClass) !== Number(classDoc._id))) {
            const specializations = await getGameSpecializations();
            specDoc = specializations.find(
                (entry) =>
                    Number(entry.relClass) === Number(classDoc._id) &&
                    slugify(entry.name) === specSlug,
            );
        }

        // check for validity
        if (
            !classSlug ||
            !specSlug ||
            !classDoc?._id ||
            !specDoc?._id ||
            Number(specDoc.relClass) !== Number(classDoc._id)
        ) {
            console.warn(
                [
                    `Invalid class/spec data at BracketTopsSchema.statics.formatQueueEntry // mem dump ...`,
                    `bracketName: ${JSON.stringify(blizResponse.name, null, 4)}`,
                    `classSlug: ${JSON.stringify(classSlug, null, 4)}`,
                    `specSlug: ${JSON.stringify(specSlug, null, 4)}`,
                    `classDoc: ${JSON.stringify(classDoc, null, 4)}`,
                    `specDoc: ${JSON.stringify(specDoc, null, 4)}`,
                ].join("\n"),
            );
            return null;
        }

        BracketTopsId = [blizResponse.name, seasonID, serverSlug].join(":");

        await upsertBracketTop({
            _id: BracketTopsId,
            region: regionDoc._id,
            season: seasonID,
            class: classDoc._id,
            specialization: specDoc._id,
            bracket: blizzardBracketID,
            characters,
        });
    }
    console.info(`bracket: ${BracketTopsId} just got saved`);
}
