import { CDNURI, AUTH } from "./cdn.config.js";

/**
 * @typedef {Object} ManifestEntry
 * @property {string} path
 * @property {string} version
 */

/**
 * @typedef {Object} Manifest
 * @property {ManifestEntry} addon
 * @property {ManifestEntry} desktop
 * @property {ManifestEntry} launcher
 */

/**
 * Fetches the latest PvP Scalpel manifest from the private CDN.
 *
 * @returns {Promise<Manifest|null>}
 */
export default async function pullManifest() {
    try {
        const response = await fetch(CDNURI + "/getManifest", {
            method: "GET",
            headers: {
                Authorization: `Bearer ${AUTH}`,
            },
        });

        if (!response.ok) {
            throw new Error(`Manifest fetch failed: ${response.status}`);
        }

        /** @type {Manifest} */
        const manifest = await response.json();

        return manifest;
    } catch (err) {
        console.warn("[CDN] Manifest error:", err);
        return null;
    }
}
