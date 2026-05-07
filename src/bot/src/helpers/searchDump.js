import { RESTFetch } from "../../../helpers/RESTFetch.js";

function normalizeSearchEntry(entry) {
    if (!entry) return null;

    const char = entry.char ?? entry;
    return {
        name: char?.name ?? null,
        realm: entry.realmName ?? char?.playerRealm?.name ?? char?.playerRealm?.slug ?? null,
        realmSlug: char?.playerRealm?.slug ?? null,
        server: char?.server ?? null,
        class: char?.class?.name ?? char?.class ?? null,
    };
}

function normalizeRealmEntry(entry) {
    if (!entry) return null;

    return {
        name: entry.name ?? null,
        slug: entry.slug ?? null,
        server: entry.server ?? null,
    };
}

function normalizeSearchResponse(req) {
    const data = req?.data ?? {};

    return {
        status: req?.status ?? 0,
        ok: Boolean(req?.ok),
        initialSearch: data.initialSearch ?? null,
        exactMatch: normalizeSearchEntry(data.exactMatch),
        chars: Array.isArray(data.chars) ? data.chars.map(normalizeSearchEntry) : [],
        realms: Array.isArray(data.realms) ? data.realms.map(normalizeRealmEntry) : [],
        error: req?.error ?? null,
    };
}

function formatDiscordJSON(data) {
    const body = JSON.stringify(data, null, 2);
    const maxLength = 1900;
    return body.length > maxLength ? `${body.slice(0, maxLength)}\n... truncated` : body;
}

export async function fetchSearchDump(search) {
    if (typeof search !== "string") {
        console.warn(`first`);
        return;
    }

    search = search.replaceAll("-", ":");
    search = search.split(":");

    while (search.length < 3) search.push("!undefined");

    search = search.join(":")
    const req = await RESTFetch(`/searchCharacter?search=${encodeURIComponent(search)}`);
    return formatDiscordJSON(normalizeSearchResponse(req));
}
