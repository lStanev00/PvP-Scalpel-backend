import puppeteer from "puppeteer";

// const TARGET_URL = "https://check-pvp.com/eu/Chamber%20of%20Aspects/Oeixx";
const TARGET_URL = "https://check-pvp.com/eu/Ravencrest/Oeixx";
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
        Object.entries(headers).filter(([name]) => !STRIPPED_REQUEST_HEADERS.has(name.toLowerCase())),
    );
}

export async function extRetChar(params) {
    const {}
    let browser;
    let context;
    let client;

    try {
        browser = await puppeteer.launch({
            headless: true,
            defaultViewport: {width: 1, height: 1},
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

        // Use an isolated context so cookies/storage from other sessions are not reused.
        context = await browser.createBrowserContext();
        const page = await context.newPage();
        client = await page.target().createCDPSession();

        // Disable caches, service workers, and browser-side cookie access before navigation starts.
        await Promise.all([
            client.send("Network.enable"),
        ]);
        await Promise.all([
            client.send("Network.setCacheDisabled", {cacheDisabled: true}),
            client.send("Network.setBypassServiceWorker", {bypass: true}),
            client.send("Network.clearBrowserCookies"),
            client.send("Network.clearBrowserCache"),
            client.send("Network.setCookieControls", {
                enableThirdPartyCookieRestriction: true,
                disableThirdPartyCookieMetadata: true,
                disableThirdPartyCookieHeuristics: true,
            }),
            client.send("Emulation.setDocumentCookieDisabled", {disabled: true}),
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

            await req.continue({headers: stripRequestHeaders(req.headers())});
        });

        // Resolve as soon as the character API returns, then close the browser instead of rendering the page.
        const captured = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Timed out waiting for character JSON")), 60000);
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
                        name: data?.name ?? null,
                        ratemaxblitz: data?.ratemaxblitz ?? null,
                        ratemaxshuffle: data?.ratemaxshuffle ?? null,
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
