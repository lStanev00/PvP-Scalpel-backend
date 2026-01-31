import helpFetch from "../../../helpers/blizFetch-helpers/endpointFetchesBliz";
import GameSpell from "../../../Models/GameSpell.js";

export default async function retriveValidSpells(spellArray) {
    if (!(Array.isArray(spellArray))) {
        throw new TypeError("The argument have to be type of Array");
    }
    if (spellArray.some((id) => typeof id !== "string" && typeof id !== "number")) {
        throw new TypeError("All ids must be strings or numbers")
    }

    const spellArraySet = new Set(spellArray);
    const data = await GameSpell.find({ _id: { $in: Array.from(spellArraySet) } }).lean();
    
    const existingSet = data.reduce((acc, entry) => {
      acc.add(String(entry._id));
      return acc;
    }, new Set());

    for (const existingId of existingSet) spellArraySet.delete(existingId);

    for (const needsRetrivingID of spellArraySet) {
        const newData = helpFetch.getSpellById(needsRetrivingID);

        const newEntry = {};


        if (newData === null || !newData) {
            newEntry._id = needsRetrivingID,
            newEntry.name = newData
        } else if (newData.name) {
            newEntry._id = needsRetrivingID;
            newEntry.name = newData.name;
            newEntry.description = newData.description;
            newEntry.media = newData.media;

        }

        const newDBEntry = new GameSpell(newEntry);
        await newDBEntry.save()
    }

}