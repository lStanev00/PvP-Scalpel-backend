// Offline database-shaped reference IDs used by the real-post regression fixtures.
export const classes = [
    [1, "Warrior"], [2, "Paladin"], [3, "Hunter"], [4, "Rogue"],
    [5, "Priest"], [6, "Death Knight"], [7, "Shaman"], [8, "Mage"],
    [9, "Warlock"], [10, "Monk"], [11, "Druid"], [12, "Demon Hunter"], [13, "Evoker"],
].map(([_id, name]) => ({ _id, name }));

export const specs = [
    [71,"Arms",1], [72,"Fury",1], [73,"Protection",1],
    [65,"Holy",2], [66,"Protection",2], [70,"Retribution",2],
    [253,"Beast Mastery",3], [254,"Marksmanship",3], [255,"Survival",3],
    [259,"Assassination",4], [260,"Outlaw",4], [261,"Subtlety",4],
    [256,"Discipline",5], [257,"Holy",5], [258,"Shadow",5],
    [250,"Blood",6], [251,"Frost",6], [252,"Unholy",6],
    [262,"Elemental",7], [263,"Enhancement",7], [264,"Restoration",7],
    [62,"Arcane",8], [63,"Fire",8], [64,"Frost",8],
    [265,"Affliction",9], [266,"Demonology",9], [267,"Destruction",9],
    [268,"Brewmaster",10], [269,"Windwalker",10], [270,"Mistweaver",10],
    [102,"Balance",11], [103,"Feral",11], [104,"Guardian",11], [105,"Restoration",11],
    [577,"Havoc",12], [581,"Vengeance",12], [1480,"Devourer",12],
    [1467,"Devastation",13], [1468,"Preservation",13], [1473,"Augmentation",13],
].map(([_id, name, relClass]) => ({ _id, name, relClass }));
