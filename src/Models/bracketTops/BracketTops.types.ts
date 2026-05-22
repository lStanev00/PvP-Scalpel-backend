import type { HydratedDocument, Model } from "mongoose";

export type BracketTopCharacter = {
    /**
     * Normalized character search key, built from name, realm, and region/server.
     */
    search: string;
    /**
     * Ladder rating for this bracket entry.
     */
    rating: number;
    /**
     * Ladder rank for this bracket entry.
     */
    rank: number;
};

export type BracketTopsAttrs = {
    /**
     * Composite bracket-top id, usually `bracketSlug:seasonId:regionSlug`.
     * Dynamic brackets may include class/spec data in the key.
     */
    _id: string;
    /**
     * Region id ref (`Region._id`).
     */
    region: number;
    /**
     * Blizzard PvP season id.
     */
    season: number;
    /**
     * Optional playable class id ref (`GameClass._id`) for dynamic brackets.
     */
    class?: number;
    /**
     * Optional specialization id ref (`GameSpecialization._id`) for dynamic brackets.
     */
    specialization?: number;
    /**
     * Blizzard bracket id. Populate `bracketDoc` to resolve the related `GameBrackets` row by `blizID`.
     */
    bracket: number;
    /**
     * Ranked ladder entries for this bracket.
     */
    characters: BracketTopCharacter[];
};

export type BlizzardBracketTopResponse = {
    _links?: {
        self?: {
            href?: string;
        };
    };
    season: {
        id: number | string;
    };
    bracket: {
        id: number | string;
    };
    name: string;
    entries: Array<{
        character: {
            name: string;
            realm: {
                slug: string;
            };
        };
        rating: number | string;
        rank: number | string;
    }>;
};

export type BracketTopsDocument = HydratedDocument<BracketTopsAttrs>;

export type FormatBracketTopsStatic = (
    this: BracketTopsModel,
    blizResponse: BlizzardBracketTopResponse,
) => Promise<void | null>;

export type BracketTopsModel = Model<BracketTopsAttrs> & {
    formatBracketTops: FormatBracketTopsStatic;
};
