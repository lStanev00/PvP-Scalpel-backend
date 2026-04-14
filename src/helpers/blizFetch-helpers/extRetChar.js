import puppeteer from "puppeteer";

/**
 * @typedef {object} ExtRetCharParams
 * @property {string} name - Character name used in the external profile URL.
 * @property {string} realm - Realm slug/name used in the external profile URL.
 * @property {string} server - Region/server slug, for example `eu` or `us`.
 */

/**
 * @typedef {object} ExtRetCharRatings
 * @property {number | null} blitzRecord - Highest Blitz rating reported by the external character API.
 * @property {number | null} SSRecord - Highest Solo Shuffle rating reported by the external character API.
 */

/**
 * Opens the configured external character page and captures its same-origin
 * character API response without loading unnecessary assets.
 *
 * @param {ExtRetCharParams} params - Character identity used to build the external profile URL.
 * @returns {Promise<ExtRetCharRatings>} Captured external rating records.
 * @throws {Error} When the browser cannot load the page or the character JSON is not captured before timeout.
 */
export async function extRetChar(params) {
    let { name, realm, server } = params;

    // realm normalization for the url
    while (realm.includes("-")) {
        realm = realm.trim();
        const indexOfSeparator = realm.indexOf("-");
        // to uppercase the following sym b4 replacement
        realm[indexOfSeparator + 1] = realm[indexOfSeparator + 1].toUpperCase();
        realm.replace("-", "%20");
    }

    let browser;
    let context;
    let client;

    try {
        browser = await puppeteer.launch({
            headless: true,
            defaultViewport: { width: 1, height: 1 },
            args: [
                "--disable-background-networking",
                "--disable-component-update",
                "--disable-default-apps",
                "--disable-extensions",
                "--disable-features=PrivacySandboxAdsAPIs,InterestCohort,AdInterestGroupAPI,Fledge,AttributionReporting,SharedStorageAPI,TopicsAPI",
                "--disable-gpu",
                "--disable-sync",
                "--mute-audio",
                "--no-default-browser-check",
                "--no-first-run",
            ],
        });
        // const TARGET_URL = "${EXT_DOMAIN}/eu/Chamber%20of%20Aspects/Oeixx";
        const EXT_DOMAIN = process.env.EXT_DOMAIN;
        const TARGET_URL = `${EXT_DOMAIN}/${server}/${realm}/${name}`;
        const TARGET_ORIGIN = new URL(TARGET_URL).origin;
        const API_URL_PART = `${TARGET_ORIGIN}/api/characters/`;

        // Block resource classes that are not needed for API discovery and can increase RAM or tracking surface.
        const BLOCKED_RESOURCE_TYPES = new Set([
            "font",
            "image",
            "media",
            "stylesheet",
            "websocket",
            "eventsource",
            "ping",
            "prefetch",
            "manifest",
            "texttrack",
            "signedexchange",
            "cspviolationreport",
            "fedcm",
            "other",
        ]);
        const ALLOWED_RESOURCE_TYPES = new Set(["document", "script", "xhr", "fetch", "preflight"]);

        // Remove cookies and high-entropy client hints before same-origin requests leave the browser.
        const STRIPPED_REQUEST_HEADERS = new Set([
            "cookie",
            "sec-ch-ua-platform",
            "sec-ch-ua-platform-version",
            "sec-ch-ua-model",
            "sec-ch-ua-arch",
            "sec-ch-ua-bitness",
        ]);

        function isSameOrigin(url) {
            try {
                return new URL(url).origin === TARGET_ORIGIN;
            } catch {
                return false;
            }
        }

        function stripRequestHeaders(headers) {
            return Object.fromEntries(
                Object.entries(headers).filter(
                    ([name]) => !STRIPPED_REQUEST_HEADERS.has(name.toLowerCase()),
                ),
            );
        }

        // Use an isolated context so cookies/storage from other sessions are not reused.
        context = await browser.createBrowserContext();
        const page = await context.newPage();
        client = await page.target().createCDPSession();

        // Disable caches, service workers, and browser-side cookie access before navigation starts.
        await Promise.all([client.send("Network.enable")]);
        await Promise.all([
            client.send("Network.setCacheDisabled", { cacheDisabled: true }),
            client.send("Network.setBypassServiceWorker", { bypass: true }),
            client.send("Network.clearBrowserCookies"),
            client.send("Network.clearBrowserCache"),
            client.send("Network.setCookieControls", {
                enableThirdPartyCookieRestriction: true,
                disableThirdPartyCookieMetadata: true,
                disableThirdPartyCookieHeuristics: true,
            }),
            client.send("Emulation.setDocumentCookieDisabled", { disabled: true }),
        ]);

        await page.setRequestInterception(true);
        page.on("request", async (req) => {
            const resourceType = req.resourceType();

            // Keep only same-origin page/script/API traffic; drop ads, websockets, media, and unknown extras.
            if (
                !isSameOrigin(req.url()) ||
                BLOCKED_RESOURCE_TYPES.has(resourceType) ||
                !ALLOWED_RESOURCE_TYPES.has(resourceType)
            ) {
                await req.abort();
                return;
            }

            await req.continue({ headers: stripRequestHeaders(req.headers()) });
        });

        // Resolve as soon as the character API returns, then close the browser instead of rendering the page.
        const captured = new Promise((resolve, reject) => {
            const timeout = setTimeout(
                () => reject(new Error("Timed out waiting for character JSON")),
                60000,
            );
            let isCaptured = false;

            page.on("response", async (res) => {
                try {
                    if (isCaptured) return;

                    const url = res.url();
                    if (!url.includes(API_URL_PART)) return;
                    if (res.status() !== 200) return;

                    isCaptured = true;
                    const data = await res.json();
                    const ratings = {
                        blitzRecord: data?.ratemaxblitz ?? null,
                        SSRecord: data?.ratemaxshuffle ?? null,
                    };
                    clearTimeout(timeout);
                    resolve(ratings);
                } catch (error) {
                    clearTimeout(timeout);
                    reject(error);
                }
            });
        });

        const navigation = page.goto(TARGET_URL, {
            waitUntil: "domcontentloaded",
            timeout: 60000,
        });

        return await Promise.race([captured, navigation.then(() => captured)]);
    } catch (error) {
        console.error("Failed to capture JSON:", error);
        throw error;
    } finally {
        await client?.detach().catch(() => {});
        await context?.close().catch(() => {});
        await browser?.close();
    }
}
