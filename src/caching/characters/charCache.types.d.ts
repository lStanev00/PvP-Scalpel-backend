export interface CharacterRealm {
    name: string;
    slug: string;
}

export interface CharacterClassInfo {
    name: string;
    media: string;
}

export interface CharacterActiveSpec {
    name: string;
    media: string;
}

export interface CharacterMedia {
    avatar: string;
    banner: string;
    charImg: string;
}

export interface CharacterTalents {
    talentsCode: string | null;
    talentsSpec: string | null;
}

export interface CharacterGuildInsight {
    rank: string | undefined;
    rankNumber: number | undefined;
}

export interface CharacterRecord {
    _id: string;
    blizID: number;
    name: string;
    playerRealm: CharacterRealm;
    guildMember: boolean;
    level: number;
    faction: string;
    race: string;
    class: CharacterClassInfo;
    activeSpec: CharacterActiveSpec;
    rating: unknown;
    achieves: unknown;
    media: CharacterMedia;
    checkedCount: number;
    server: string;
    gear: unknown;
    lastLogin: number | undefined;
    equipmentStats: unknown;
    likes: unknown[];
    listAchievements: unknown[];
    guildName: string | undefined;
    guildInsight: CharacterGuildInsight;
    talents: CharacterTalents;
    search: string;
    posts?: unknown[];
    favorite?: unknown;
    createdAt: Date | string | number;
    updatedAt: Date | string | number;
}
