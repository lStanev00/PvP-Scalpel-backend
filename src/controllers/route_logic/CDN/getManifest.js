// @ts-check

import CDNManifest from "../../../Models/CDNManifest.js";

/**
 * A single CDN manifest entry
 * @typedef {Object} CDNManifestEntry
 * @property {string} version
 * @property {string} path
 */

/**
 * Map of manifest entries keyed by customId
 * @typedef {Object.<string, CDNManifestEntry>} CDNManifestMap
 */

/**
 * Builds a CDN manifest map from the database
 *
 * @returns {Promise<CDNManifestMap | null>}
 */
export default async function formManifest() {
    try {
        const manifests = await CDNManifest.find().lean();

        /** @type {CDNManifestMap} */
        const result = {};

        for (const manifest of manifests) {
            if (
                typeof manifest !== "object" ||
                manifest === null ||
                typeof manifest.customId !== "string" ||
                typeof manifest.version !== "string" ||
                typeof manifest.path !== "string"
            ) {
                continue;
            }

            result[manifest.customId] = {
                version: manifest.version,
                path: manifest.path,
            };
        }

        return result;
    } catch (error) {
        console.warn(error);
        return null;
    }
}
