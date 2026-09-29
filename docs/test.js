const BASE_URL = "https://us.forums.blizzard.com/en/wow";

function isClassTuning(title = "") {
    return /^class tuning incoming/i.test(title);
}

function isBlizzardPost(post) {
    return post?.staff === true;
}

async function getJson(url) {
    const response = await fetch(url, {
        headers: {
            Accept: "application/json",
        },
    });

    if (!response.ok) {
        throw new Error(
            `Request failed: ${response.status} ${response.statusText}\n${url}`
        );
    }

    return response.json();
}

function htmlToText(html = "") {
    return html
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n\n")
        .replace(/<li[^>]*>/gi, "• ")
        .replace(/<\/li>/gi, "\n")
        .replace(/<\/h[1-6]>/gi, "\n\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&hellip;/g, "...")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

/*
    Find newest OFFICIAL Blizzard "Class Tuning Incoming" topic.
*/
async function getLatestClassTuning() {
    const query = '"class tuning incoming" order:latest';

    const url =
        `${BASE_URL}/search.json?q=${encodeURIComponent(query)}`;

    console.log("Searching Blizzard forum...\n");

    const searchData = await getJson(url);

    const candidates = (searchData.topics ?? [])
        .filter((topic) => isClassTuning(topic.title))
        .sort(
            (a, b) =>
                new Date(b.created_at) - new Date(a.created_at)
        );

    if (!candidates.length) {
        throw new Error("No Class Tuning topics found.");
    }

    /*
        Search can contain player-created topics.

        Check each candidate until we find one where
        post #1 was made by Blizzard staff.
    */
    for (const candidate of candidates) {
        const topic = await getJson(
            `${BASE_URL}/t/${candidate.id}.json`
        );

        const originalPost =
            topic.post_stream?.posts?.find(
                (post) => post.post_number === 1
            );

        if (!originalPost) {
            continue;
        }

        if (!isBlizzardPost(originalPost)) {
            continue;
        }

        return topic;
    }

    throw new Error(
        "Found Class Tuning topics, but none were verified as Blizzard staff posts."
    );
}

/*
    Topic JSON normally contains:

    post_stream.stream = [
        123,
        124,
        125,
        ...
    ]

    These are the IDs of ALL posts.

    post_stream.posts itself may only contain a subset,
    so we fetch every ID in batches.
*/
async function getAllPosts(topic) {
    const postIds = topic.post_stream?.stream ?? [];

    if (!postIds.length) {
        return topic.post_stream?.posts ?? [];
    }

    const posts = [];

    const CHUNK_SIZE = 20;

    for (
        let index = 0;
        index < postIds.length;
        index += CHUNK_SIZE
    ) {
        const chunk = postIds.slice(
            index,
            index + CHUNK_SIZE
        );

        const params = new URLSearchParams();

        for (const postId of chunk) {
            params.append(
                "post_ids[]",
                String(postId)
            );
        }

        const url =
            `${BASE_URL}/t/${topic.id}/posts.json?${params}`;

        const data = await getJson(url);

        posts.push(
            ...(data.post_stream?.posts ?? [])
        );
    }

    /*
        Just in case Discourse returns duplicates.
    */
    const uniquePosts = [
        ...new Map(
            posts.map((post) => [
                post.id,
                post,
            ])
        ).values(),
    ];

    return uniquePosts.sort(
        (a, b) =>
            a.post_number - b.post_number
    );
}

function logPost(post, topic) {
    const edited = Number(post.version) > 1;

    console.log(
        "\n============================================================"
    );

    console.log(
        `POST #${post.post_number}`
    );

    console.log(
        `Author: ${post.username}`
    );

    console.log(
        `Title: ${post.user_title ?? "N/A"}`
    );

    console.log(
        `Staff: ${post.staff}`
    );

    console.log(
        `Created: ${post.created_at}`
    );

    console.log(
        `Updated: ${post.updated_at}`
    );

    console.log(
        `Version: ${post.version}`
    );

    console.log(
        `Edited: ${edited ? "YES" : "NO"}`
    );

    console.log(
        `URL: ${BASE_URL}/t/${topic.slug}/${topic.id}/${post.post_number}`
    );

    console.log(
        "------------------------------------------------------------"
    );

    console.log(
        htmlToText(post.cooked)
    );

    console.log(
        "============================================================"
    );
}

async function main() {
    console.log(
        "\n=== BLIZZARD CLASS TUNING TEST ===\n"
    );

    const topic =
        await getLatestClassTuning();

    console.log(
        "LATEST OFFICIAL CLASS TUNING"
    );

    console.log({
        id: topic.id,
        title: topic.title,
        slug: topic.slug,
        createdAt: topic.created_at,
        lastPostedAt: topic.last_posted_at,
        postsCount: topic.posts_count,
        highestPostNumber:
            topic.highest_post_number,
        url:
            `${BASE_URL}/t/${topic.slug}/${topic.id}`,
    });

    console.log(
        "\nFetching ALL replies..."
    );

    const posts =
        await getAllPosts(topic);

    console.log(
        `Total posts fetched: ${posts.length}`
    );

    /*
        Blizzard posts only.
    */
    const blizzardPosts =
        posts.filter(isBlizzardPost);

    const originalPost =
        blizzardPosts.find(
            (post) =>
                post.post_number === 1
        );

    const blizzardFollowups =
        blizzardPosts.filter(
            (post) =>
                post.post_number > 1
        );

    console.log(
        `Blizzard posts: ${blizzardPosts.length}`
    );

    console.log(
        `Blizzard follow-up replies: ${blizzardFollowups.length}`
    );

    /*
        ORIGINAL POST
    */
    if (originalPost) {
        console.log(
            "\n\n################ ORIGINAL BLIZZARD POST ################"
        );

        logPost(
            originalPost,
            topic
        );
    }

    /*
        IMPORTANT PART:
        later Blizzard replies containing amendments /
        additions to the tuning.
    */
    console.log(
        "\n\n################ BLIZZARD FOLLOW-UP UPDATES ################"
    );

    if (!blizzardFollowups.length) {
        console.log(
            "\nNo Blizzard follow-up replies found."
        );
    }

    for (const post of blizzardFollowups) {
        logPost(
            post,
            topic
        );
    }

    /*
        Separately show anything Blizzard edited.
    */
    const editedBlizzardPosts =
        blizzardPosts.filter(
            (post) =>
                Number(post.version) > 1
        );

    console.log(
        "\n\n################ EDITED BLIZZARD POSTS ################"
    );

    console.log(
        `Edited Blizzard posts: ${editedBlizzardPosts.length}`
    );

    for (const post of editedBlizzardPosts) {
        console.log({
            postNumber:
                post.post_number,

            author:
                post.username,

            version:
                post.version,

            createdAt:
                post.created_at,

            updatedAt:
                post.updated_at,

            url:
                `${BASE_URL}/t/${topic.slug}/${topic.id}/${post.post_number}`,
        });
    }
}

main().catch((error) => {
    console.error(
        "\nERROR:",
        error
    );

    process.exit(1);
});