const BASE_URL = "https://eu.forums.blizzard.com/en/wow";
const FEED_URL = `${BASE_URL}/groups/blizzard-tracker/posts.json`;

/** List every new EU English WoW Blizzard staff post, oldest first. */
export async function getNewBluePosts({ cursor = null, since = null, fetchImpl = fetch } = {}) {
    const posts = [];
    const seen = new Set();
    let beforePostId;
    let newestId = null;

    while (true) {
        const url = new URL(FEED_URL);
        if (beforePostId) url.searchParams.set("before_post_id", beforePostId);
        const response = await fetchImpl(url);
        if (!response.ok) throw new Error(`Blizzard staff feed returned ${response.status}`);
        const page = (await response.json()).posts;
        if (!Array.isArray(page)) throw new Error("Invalid Blizzard staff feed response");
        if (page.length === 0) break;

        if (newestId === null) newestId = String(page[0].id);
        let finished = false;
        for (const post of page) {
            const id = Number(post.id);
            if (!Number.isSafeInteger(id) || id <= 0) continue;
            if (cursor && id <= Number(cursor)) { finished = true; break; }
            if (since && new Date(post.created_at) < since) { finished = true; break; }
            if (seen.has(id)) continue;
            seen.add(id);
            if (post.post_type !== 1) continue;
            const postPath = post.url?.startsWith("/t/") ? `/en/wow${post.url}` : post.url;
            const url = new URL(postPath, `${BASE_URL}/`);
            if (url.origin !== new URL(BASE_URL).origin || !url.pathname.startsWith("/en/wow/t/")) continue;
            posts.push({
                id,
                title: post.topic_title,
                createdAt: post.created_at,
                url: url.href,
            });
        }
        if (finished || page.length < 20) break;
        const oldestId = String(page.at(-1).id);
        if (oldestId === beforePostId) throw new Error("Blizzard staff feed did not advance");
        beforePostId = oldestId;
    }

    posts.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    return { posts, newestId };
}
