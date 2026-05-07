export default function pipeUserInput(rawData) {
    if (typeof rawData !== "string") throw new TypeError("The text argument has to be a string type");

    const teamBasedMatchRegex = /^(?<bracketID>\d+)\[(?<team1String>[^\]]+)\](?:\[(?<team2String>[^\]]*)\])?$/;
    const match = teamBasedMatchRegex.exec(rawData.trim());

    if (!match?.groups) {
        return ["Error", "Invalid queueCheck group payload."];
    }

    const { bracketID, team1String, team2String = "" } = match.groups;
    const idNR = Number(bracketID);

    return [
        idNR,
        team1String.split("|"),
        team2String ? team2String.split("|") : [],
    ];

}
// -> legacy
// 2
// |Slothx:ravencrest:eu(251)
// |agnarkarma:archimonde:eu(270)
// |Drdx:stormscale:eu(64)
// |Sowiluj:silvermoon:eu(102)
// |Beowullf:spinebreaker:eu(72)
// |Мотумбатор:свежевательдуш:eu(267)
// |Lychezar:chamber-of-aspects:eu(73)
// |Hetma:burning-legion:eu(1468)

// -> team based example
// 2 - the bracekt ID
// [
//     Adventureman:argent-dawn:eu(254)
//     |Oifik:frostmane:eu(1480)
//     |Zamruka:ravenholdt:eu(261)
//     |Калмычка:gordunni:eu(256)
//     |Akemi:eredar:eu(252)
//     |Øéyx:ravencrest:eu(1468)
//     |Lychezar:chamber-of-aspects:eu(73)
//     |Снюсловер:gordunni:eu(102)
// ] - team 1 end here
// [
//     Aylanur:ravencrest:eu(103)
//     |Balúr:thrall:eu(264)
//     |Canhalli:the-maelstrom:eu(270)
//     |Causality:sylvanas:eu(577)
//     |Ledva:drakthul:eu(70)
//     |Onlylock:ragnaros:eu(267)
//     |Tyranorde:hyjal:eu(73)
//     |Zaijko:stormscale:eu(251)
// ] - team 2 end here

// -> raw
// 2[Adventureman:argent-dawn:eu(254)|Oifik:frostmane:eu(1480)|Zamruka:ravenholdt:eu(261)|Калмычка:gordunni:eu(256)|Akemi:eredar:eu(252)|Øéyx:ravencrest:eu(1468)|Lychezar:chamber-of-aspects:eu(73)|Снюсловер:gordunni:eu(102)][Aylanur:ravencrest:eu(103)|Balúr:thrall:eu(264)|Canhalli:the-maelstrom:eu(270)|Causality:sylvanas:eu(577)|Ledva:drakthul:eu(70)|Onlylock:ragnaros:eu(267)|Tyranorde:hyjal:eu(73)|Zaijko:stormscale:eu(251)]
