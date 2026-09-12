const BASE_URL = "https://eu.forums.blizzard.com/en/wow";

/**
 * Fetches the most recent normal staff post from the latest official
 * "Class Tuning Incoming" topic on the Blizzard EU World of Warcraft forum.
 *
 * Search results are checked newest-first. Topics whose opening post was not
 * created by Blizzard staff are ignored, as are system and moderator events.
 *
 * @async
 * @returns {Promise<{
 *   id: number,
 *   title: string,
 *   createdAt: string,
 *   url: string
 * } | null>} The latest Blizzard post details, or `null` when no matching
 * official topic is found.
 * @throws {Error} If the initial Blizzard forum search request fails.
 */
export async function getLatestPNotes() {
    const query = '"class tuning incoming" order:latest';

    const searchRes = await fetch(
        `${BASE_URL}/search.json?q=${encodeURIComponent(query)}`
    );

    if (!searchRes.ok) {
        throw new Error(
            `Blizzard returned ${searchRes.status}`
        );
    }

    const searchData = await searchRes.json();

    const candidates = (searchData.topics ?? [])
        .filter((topic) =>
            /^class tuning incoming/i.test(topic.title)
        )
        .sort(
            (a, b) =>
                new Date(b.created_at) -
                new Date(a.created_at)
        );

    for (const candidate of candidates) {
        const topicRes = await fetch(
            `${BASE_URL}/t/${candidate.id}.json`
        );

        if (!topicRes.ok) {
            continue;
        }

        const topic = await topicRes.json();

        const firstPost =
            topic.post_stream?.posts?.find(
                (post) =>
                    post.post_number === 1 &&
                    post.post_type === 1
            );

        /*
            Must be an official Blizzard-created topic.
        */
        if (!firstPost?.staff) {
            continue;
        }

        const postIds =
            topic.post_stream?.stream ?? [];

        const posts = [];

        for (
            let i = 0;
            i < postIds.length;
            i += 20
        ) {
            const chunk =
                postIds.slice(i, i + 20);

            const params =
                new URLSearchParams();

            for (const postId of chunk) {
                params.append(
                    "post_ids[]",
                    String(postId)
                );
            }

            const postsRes = await fetch(
                `${BASE_URL}/t/${topic.id}/posts.json?${params}`
            );

            if (!postsRes.ok) {
                continue;
            }

            const data =
                await postsRes.json();

            posts.push(
                ...(data.post_stream?.posts ?? [])
            );
        }

        /*
            IMPORTANT:

            post_type === 1
                normal actual forum post

            This excludes:
                pinned
                unpinned
                closed
                reopened
                moderator actions
                other system events
        */
        const blizzardPosts = posts
            .filter((post) =>
                post.staff === true &&
                post.post_type === 1
            )
            .sort(
                (a, b) =>
                    new Date(b.created_at) -
                    new Date(a.created_at)
            );

        const latestPost =
            blizzardPosts[0] ??
            firstPost;

        return {
            id: latestPost.id,
            title: topic.title,
            createdAt:
                latestPost.created_at,
            url:
                `${BASE_URL}/t/${topic.slug}/${topic.id}/${latestPost.post_number}`,
        };
    }

    return null;
}
// console.info(await getLatestPNotes());
// debugger;
