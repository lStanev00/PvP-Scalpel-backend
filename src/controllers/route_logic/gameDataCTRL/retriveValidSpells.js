import helpFetch from "../../../helpers/blizFetch-helpers/endpointFetchesBliz.js";
import GameSpell from "../../../Models/GameSpell.js";

export default async function retriveValidSpells(spellArray) {
    if (!Array.isArray(spellArray)) {
        throw new TypeError("The argument have to be type of Array");
    }
    if (spellArray.some((id) => typeof id !== "string" && typeof id !== "number")) {
        throw new TypeError("All ids must be strings or numbers");
    }

    const spellArraySet = new Set(spellArray);
    const data = await GameSpell.find({ _id: { $in: Array.from(spellArraySet) } }).lean();

    const existingSet = data.reduce((acc, entry) => {
        acc.add(String(entry._id));
        return acc;
    }, new Set());

    for (const existingId of existingSet) spellArraySet.delete(existingId);

    for (const needsRetrivingID of spellArraySet) {
        const newData = await helpFetch.getSpellById(needsRetrivingID);

        const newEntry = { _id: needsRetrivingID };

        if (newData === null || !newData) {
            newEntry.name = null;
            const logPayload = { spellId: needsRetrivingID, data: newData };
            console.info(`Spell fetch returned empty data\n${JSON.stringify(logPayload, null, 2)}`);
        } else if (newData.name) {
            newEntry.name = newData.name;
            newEntry.description = newData.description;
            newEntry.media = newData.media;
        }

        const newDBEntry = new GameSpell(newEntry);
        await newDBEntry.save();

        data.push(newDBEntry.toObject());
    }

    return data;
}
