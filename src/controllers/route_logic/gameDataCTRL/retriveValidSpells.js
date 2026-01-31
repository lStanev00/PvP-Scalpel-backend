import GameSpell from "../../../Models/GameSpell.js";

export default async function retriveValidSpells(spellArray) {
    if (!(Array.isArray(spellArray))) {
        throw new TypeError("The argument have to be type of Array");
    }
    if (spellArray.some((id) => typeof id !== "string" && typeof id !== "number")) {
        throw new TypeError("All ids must be strings or numbers")
    }

    const data = await GameSpell.find({ _id: { $in: spellArray } }).lean();
    
}