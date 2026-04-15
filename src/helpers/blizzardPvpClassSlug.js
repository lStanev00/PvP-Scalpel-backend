import slugify from "./slugify.js";

/**
 * Convert a playable class name to the class slug used inside Blizzard PvP bracket keys.
 *
 * Blizzard dynamic PvP bracket keys do not always match normal hyphen slugging:
 * multi-word class names are compacted, so `Death Knight` becomes `deathknight`.
 *
 * @param {string} className
 * @returns {string | undefined}
 */
export default function blizzardPvpClassSlug(className) {
    if (typeof className !== "string") return undefined;

    const classSlug = slugify(className);
    return classSlug ? classSlug.replaceAll("-", "") : undefined;
}
