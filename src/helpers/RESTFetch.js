const DEFAULT_REST_URL = "https://api.pvpscalpel.com";

function resolveRESTBaseURL() {
    const configuredURL = process.env.REST_URL || DEFAULT_REST_URL;

    try {
        new URL(configuredURL);
        return configuredURL.replace(/\/+$/, "");
    } catch {
        return DEFAULT_REST_URL;
    }
}

function normalizeEndpoint(endpoint) {
    const normalizedEndpoint = String(endpoint || "");
    return normalizedEndpoint.startsWith("/")
        ? normalizedEndpoint
        : `/${normalizedEndpoint}`;
}

/**
 * Performs a server-side REST API request and normalizes the response shape.
 *
 * @param {string} endpoint API path appended to REST_URL.
 * @param {RequestInit} [options={}] Additional fetch options merged with defaults.
 * @returns {Promise<
 *   | { status: number, ok: true, data: unknown }
 *   | { status: number, ok: false, data?: unknown, error?: string }
 * >}
 */
export async function RESTFetch(endpoint, options = {}) {
    const defaultHeaders = {
        600: "BasicPass",
        "Content-Type": "application/json",
    };

    const finalOptions = {
        ...options,
        headers: {
            ...defaultHeaders,
            ...options.headers,
        },
    };

    try {
        const response = await fetch(
            resolveRESTBaseURL() + normalizeEndpoint(endpoint),
            finalOptions,
        );

        let data = null;
        const contentType = response.headers.get("content-type");

        if (contentType && contentType.includes("application/json")) {
            data = await response.json();
        }

        return {
            status: response.status,
            ok: response.ok,
            data,
        };
    } catch (error) {
        return {
            status: 0,
            ok: false,
            error: error.message || "REST request failed",
        };
    }
}
