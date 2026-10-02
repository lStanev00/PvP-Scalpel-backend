import helpFetch from "../helpers/blizFetch-helpers/endpointFetchesBliz.js";
import GameClass from "../Models/GameClass.js";
import GameSpecialization from "../Models/GameSpecialization.js";
import Char from "../Models/Chars.js";
import BracketTops from "../Models/bracketTops/BracketTops.js";
import { storeGameSpecializations } from "../caching/gameSpecializations/gameSpecializationsCache.js";
import getRemoteSpecs from "./Service-Helpers/updateGameClassAndSpecs/getRemoteSpecs.js";

function specIdentity({ name, relClass }) {
    return `${relClass}:${name.trim().toLowerCase()}`;
}

/**
 * Synchronizes Blizzard specializations and migrates references when an ID changes.
 *
 * @returns {Promise<void|undefined>} Resolves when the update completes, or `undefined` when required remote data is invalid.
 */
export default async function updateGameClassAndSpecs() {
    let changed = false;
    try {
        const remoteClassList = await helpFetch.fetchBlizzard(
            "https://eu.api.blizzard.com/data/wow/playable-class/index?namespace=static-eu",
        );
        if (!remoteClassList || remoteClassList === null) {
            console.warn("Problem at remote calss list fetch");
            return;
        }
        const knownClasses = await GameClass.find().populate("specs").lean();
        const updatedClasses = [];

        for (const remoteClassEntry of remoteClassList?.classes ?? []) {
            const remoteClassKey = remoteClassEntry.key;
            const remoteClassName = remoteClassEntry.name;
            const remoteClassId = remoteClassEntry.id;

            const exist = knownClasses.find((knownEntry) => knownEntry._id === remoteClassId);

            if (!exist || exist.length == 0) {
                // Produce the new class
                let remoteClassMedia = undefined;
                const classReq = await helpFetch.fetchBlizzard(remoteClassKey.href).catch(() => {
                    console.warn("classReq Failed");
                    return undefined;
                });
                if (classReq === undefined) continue;
                updatedClasses.push(classReq);

                remoteClassMedia = await helpFetch.getMedia(classReq, "media").catch(() => {
                    console.warn("error at get media in calssandspec fetch error is:\n" + error);
                    return undefined;
                });
                if (!remoteClassMedia) continue;

                const newClassEntry = new GameClass({
                    _id: remoteClassId,
                    name: remoteClassName,
                    media: remoteClassMedia,
                });
                await newClassEntry.save();
            }
        }
        if (updatedClasses.length !== 0) console.info("Amount of new classes added: " + updatedClasses.length);
        const knownSpecList = await GameSpecialization.find().lean();
        const remoteSpecMap = await getRemoteSpecs(remoteClassList?.classes);

        if (!(remoteSpecMap instanceof Map)) {
            console.warn("remoteSpecMap is not instance of `Map`");
            return undefined;
        }

        const obsoleteByIdentity = new Map();
        for (const spec of knownSpecList) {
            if (remoteSpecMap.has(spec._id)) continue;
            const identity = specIdentity(spec);
            const matches = obsoleteByIdentity.get(identity) ?? [];
            matches.push(spec);
            obsoleteByIdentity.set(identity, matches);
        }

        for (const [id, { key, name }] of remoteSpecMap) {
            const remoteSpec = await helpFetch.fetchBlizzard(key.href).catch(() => undefined);
            if (!remoteSpec) {
                console.warn(`Could not fetch specialization ${id}`);
                continue;
            }

            const media = await helpFetch.getMedia(remoteSpec, "media").catch(() => undefined);
            if (!media) {
                console.warn(`Could not fetch media for specialization ${id}`);
                continue;
            }

            const fields = {
                name,
                media,
                role: remoteSpec.role.type.toLowerCase(),
                relClass: remoteSpec.playable_class.id,
            };
            const oldMatches = obsoleteByIdentity.get(specIdentity(fields)) ?? [];

            await GameSpecialization.updateOne(
                { _id: id },
                { $set: fields },
                { upsert: true, runValidators: true },
            );
            changed = true;

            // Match by both class and name, and migrate only an unambiguous old ID.
            if (oldMatches.length === 1) {
                const oldId = oldMatches[0]._id;
                await Char.updateMany({ activeSpec: oldId }, { $set: { activeSpec: id } });
                await BracketTops.updateMany(
                    { specialization: oldId },
                    { $set: { specialization: id } },
                );
                await GameSpecialization.deleteOne({ _id: oldId });
                console.info(`Migrated specialization ${name} from ${oldId} to ${id}`);
            } else if (oldMatches.length > 1) {
                console.warn(`Ambiguous old specialization for ${name} (${fields.relClass}); ID migration skipped`);
            }
        }

    } catch (error) {
        console.warn(error);
        // throw error;
    } finally {
        if (changed) await storeGameSpecializations();
    }
}