// @ts-check

import CDNManifest from "../../../Models/CDNManifest.js";


/**
 * @typedef {Object} NewManifestBody
 * @property {string} customId
 * @property {string} version
 * @property {string} path
 */

/**
 * Creates or updates a CDN manifest entry
 *
 * @param {unknown} body
 * @returns {Promise<boolean>}
 */
export default async function newManifest(body) {
    if (typeof body !== "object" || body === null) {
        return false;
    }

    /** @type {Partial<NewManifestBody>} */
    const data = body;

    if (
        typeof data.customId !== "string" ||
        data.customId.length === 0 ||
        typeof data.version !== "string" ||
        data.version.length === 0 ||
        typeof data.path !== "string" ||
        data.path.length === 0
    ) {
        return false;
    }

    try {
        await CDNManifest.findOneAndUpdate(
            { customId: data.customId },
            {
                customId: data.customId,
                version: data.version,
                path: data.path,
            },
            {
                upsert: true,
                new: true,
                setDefaultsOnInsert: true,
            }
        );

        return true;
    } catch (error) {
        console.warn(error);
        return false;
    }
}
