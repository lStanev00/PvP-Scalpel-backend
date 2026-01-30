import helpFetch from "../helpers/blizFetch-helpers/endpointFetchesBliz.js";
import GameClass from "../Models/GameClass.js";
import GameSpecialization from "../Models/GameSpecialization.js";
import getRemoteSpecs from "./Service-Helpers/updateGameClassAndSpecs/getRemoteSpecs.js";

export default async function updateGameClassAndSpecs() {
    try {
        const remoteClassList = await helpFetch.fetchBlizzard(
            "https://eu.api.blizzard.com/data/wow/playable-class/index?namespace=static-eu",
        );
        if (!remoteClassList || remoteClassList === null) {
            console.warn("Problem at remote calss list fetch");
            return;
        }
        const knownClasses = await GameClass.find().lean();
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
                newClassEntry.save();
            }
        }
        console.info("Amount of new classes added: " + updatedClasses.length);
        const knownSpecList = await GameSpecialization.find().lean();
        const remoteSpecMap = await getRemoteSpecs(remoteClassList?.classes);

        if (!(remoteSpecMap instanceof Map)) {
            console.warn("remoteSpecMap is not instance of `Map`");
            return undefined;
        }

        if (knownSpecList.length !== 0) {
            for (const { _id } of knownSpecList) {
                if (typeof _id !== "number") {
                    console.warn("_id is not a number");
                    continue;
                }

                remoteSpecMap.delete(_id);
            }
        }

        // attempt to spec update
        for (const [id, { key, name }] of remoteSpecMap) {
            const remoteSpec = await helpFetch.fetchBlizzard(key.href).catch(() => undefined);
            if (!remoteSpec) {
                console.warn(
                    `problem at remoteSpecLooped url extract type is: ${typeof remoteSpec}`,
                );
                continue;
            }

            const media = await helpFetch.getMedia(remoteSpec, "media").catch(() => undefined);

            if (!media) {
                console.warn("Problem at media extraction for ");
                continue;
            }

            const newEntry = new GameSpecialization({
                _id: id,
                name,
                media,
                role: remoteSpec.role.type.toLowerCase(),
                relClass: remoteSpec["playable_class"].id,
            });
            await newEntry.save();
        }

        console.info("Amount of new specs added: " + remoteSpecMap.size);
    } catch (error) {
        console.warn(error);
        debugger;
    }
}
