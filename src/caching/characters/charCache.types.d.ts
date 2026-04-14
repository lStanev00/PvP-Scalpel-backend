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

export interface CharacterRatingTitle {
    name?: string;
    media?: string;
}

export interface CharacterRatingCurrentSeason {
    rating: number;
    title?: CharacterRatingTitle;
    seasonMatchStatistics?: unknown;
    weeklyMatchStatistics?: unknown;
}

export interface CharacterRatingBracket {
    currentSeason?: CharacterRatingCurrentSeason;
    lastSeasonLadder?: unknown;
    record?: number | null;
    _id?: string;
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
    rating: Record<string, CharacterRatingBracket>;
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
