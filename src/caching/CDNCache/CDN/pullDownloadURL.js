import { CDNAUTH, CDNURI } from "./cdn.config.js";
import { getManifest, storeNewManifest } from "../manifestCache.js";

/**
 * Fetch a presigned download URL for a manifest entry.
 * Retries once with a fresh manifest when the CDN reports a missing object.
 * @param {"addon"|"desktop"|"launcher"} targetKey Manifest entry key.
 * @returns {Promise<{version: string, url: string, expiresIn: number}|null>}
 */
export default async function pullDownloadUrlForApp(targetKey) {
    try {
        /**
         * Post the presign request using the provided manifest.
         * @param {Object<string, {path: string, version: string}>|null} currentManifest
         * @returns {Promise<{response: Response, download: any, version: string}|null>}
         */
        const fetchWithManifest = async (currentManifest) => {
            if (!currentManifest || !currentManifest[targetKey]) return null;

            const { path, version } = currentManifest[targetKey];
            const response = await fetch(`${CDNURI}/presign/download`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${CDNAUTH}`,
                },
                body: JSON.stringify({
                    keyId: path,
                }),
            });
            const download = await response.json();

            return {
                response,
                download,
                version,
            };
        };

        let manifest = await getManifest();
        let result = await fetchWithManifest(manifest);

        const message =
            typeof result?.download === "string"
                ? result.download
                : result?.download?.message || result?.download?.error;
        const notFound =
            !result ||
            (result.response && !result.response.ok) ||
            (typeof message === "string" &&
                /not found|does not exist/i.test(message));

        if (notFound) {
            manifest = await storeNewManifest();
            result = await fetchWithManifest(manifest);
        }

        if (!result) return null;

        return {
            version: result.version,
            url:
                typeof result.download === "string"
                    ? result.download
                    : result.download?.url || result.download?.downloadUrl,
            expiresIn:
                typeof result.download === "string"
                    ? 0
                    : result.download?.expiresIn,
        };
    } catch (error) {
        console.error(error);
        return null;
    }
}
