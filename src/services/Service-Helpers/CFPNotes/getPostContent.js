/**
 * @typedef {Object} ClassTuningPostRef
 * @property {number} id - Discourse post ID.
 * @property {string} title - Class tuning topic title.
 * @property {string} createdAt - ISO creation date of the post.
 * @property {string} url - Public Blizzard forum URL of the post.
 */

/**
 * @typedef {Object} ClassTuningPostContent
 * @property {number} id - Discourse post ID.
 * @property {string} title - Class tuning topic title.
 * @property {string} createdAt - ISO creation date.
 * @property {string} updatedAt - ISO date of the latest edit.
 * @property {string} url - Public Blizzard forum URL.
 * @property {string} author - Blizzard forum username.
 * @property {string|null} authorTitle - Forum title, e.g. "Community Manager".
 * @property {number} postNumber - Post number inside the topic.
 * @property {number} version - Current revision number of the post.
 * @property {string} html - Original rendered HTML returned by Discourse.
 * @property {string} content - Plain-text version of the post.
 */

/**
 * Converts Discourse-rendered HTML into readable plain text.
 *
 * @param {string} html
 * @returns {string}
 */
export function htmlToText(html = "") {
    let listDepth = 0;

    return html
        .replace(/<(?:s|del)\b[^>]*>/gi, "[WITHDRAWN] ")
        .replace(/<\/(?:s|del)>/gi, " [\/WITHDRAWN]")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n\n")
        .replace(
            /<\/?(?:ul|ol)\b[^>]*>|<li\b[^>]*>|<\/li>/gi,
            (tag) => {
                if (/^<\/(?:ul|ol)/i.test(tag)) {
                    listDepth = Math.max(0, listDepth - 1);
                    return "\n";
                }
                if (/^<(?:ul|ol)/i.test(tag)) {
                    listDepth += 1;
                    return "\n";
                }
                if (/^<li/i.test(tag)) {
                    return `${"  ".repeat(Math.max(0, listDepth - 1))}• `;
                }

                return "\n";
            },
        )
        .replace(/<\/h[1-6]>/gi, "\n\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&hellip;/g, "...")
        .replace(/&#8211;/g, "–")
        .replace(/&#8212;/g, "—")
        .replace(/&#8217;/g, "'")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

/**
 * Determines the Blizzard forum base URL from the supplied post URL.
 *
 * Example:
 *
 * https://eu.forums.blizzard.com/en/wow/t/...
 *
 * becomes:
 *
 * https://eu.forums.blizzard.com/en/wow
 *
 * @param {string} postUrl
 * @returns {string}
 */
function getForumBaseUrl(postUrl) {
    const url = new URL(postUrl);

    const parts = url.pathname
        .split("/")
        .filter(Boolean);

    if (parts.length < 2) {
        throw new Error(
            `Invalid Blizzard forum URL: ${postUrl}`
        );
    }

    return `${url.origin}/${parts[0]}/${parts[1]}`;
}

/**
 * Retrieves the full content of a Blizzard Class Tuning post.
 *
 * The supplied object should be the structure returned by
 * getLatestClassTuning().
 *
 * @param {ClassTuningPostRef} postRef
 * @returns {Promise<ClassTuningPostContent>}
 *
 * @throws {TypeError} If the supplied object is invalid.
 * @throws {Error} If Blizzard fails to return the post.
 *
 * @example
 * const post = await getLatestClassTuning();
 *
 * const content =
 *     await getClassTuningPostContent(post);
 *
 * console.log(content.content);
 */
export default async function getPostContent(
    postRef
) {
    if (
        !postRef ||
        typeof postRef !== "object"
    ) {
        throw new TypeError(
            "postRef must be an object."
        );
    }

    if (
        !postRef.id ||
        !Number.isInteger(Number(postRef.id))
    ) {
        throw new TypeError(
            "postRef.id must contain a valid post ID."
        );
    }

    if (
        typeof postRef.url !== "string" ||
        !postRef.url
    ) {
        throw new TypeError(
            "postRef.url must contain a Blizzard forum URL."
        );
    }

    const baseUrl =
        getForumBaseUrl(postRef.url);

    const response = await fetch(
        `${baseUrl}/posts/${postRef.id}.json`,
        {
            headers: {
                Accept: "application/json",
            },
        }
    );

    if (!response.ok) {
        throw new Error(
            `Failed to retrieve Blizzard post ${postRef.id}: ` +
            `${response.status} ${response.statusText}`
        );
    }

    const post =
        await response.json();

    /*
        Extra safety since this function is meant
        specifically for official Blizzard posts.
    */
    if (post.staff !== true) {
        throw new Error(
            `Post ${postRef.id} is not a Blizzard staff post.`
        );
    }

    return {
        id:
            post.id,

        title:
            postRef.title,

        createdAt:
            post.created_at,

        updatedAt:
            post.updated_at,

        url:
            postRef.url,

        author:
            post.username,

        authorTitle:
            post.user_title ?? null,

        postNumber:
            post.post_number,

        version:
            Number(post.version ?? 1),

        html:
            post.cooked ?? "",

        content:
            htmlToText(post.cooked ?? ""),
    };
}
