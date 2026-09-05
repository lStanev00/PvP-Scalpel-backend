import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
} from "discord.js";

import {
    createCanvas,
    loadImage,
} from "@napi-rs/canvas";

import MediaMeta from "../../../Models/MediaMeta.js";

const CDN_ROOT =
    "https://bucket.pvpscalpel.com/pvp-scalpel-frontend/";

// DejaVu Sans is installed in the bot image; Arial supports local Windows runs.
const FONT_FAMILY = '"DejaVu Sans", Arial, sans-serif';
const TEXT_SEGMENTER = new Intl.Segmenter(undefined, {
    granularity: "grapheme",
});

function ellipsizeText(ctx, text, maxWidth, force = false) {
    if (!force && ctx.measureText(text).width <= maxWidth) {
        return text;
    }

    const characters = Array.from(
        TEXT_SEGMENTER.segment(text),
        ({ segment }) => segment,
    );
    let low = 0;
    let high = characters.length;

    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        const candidate =
            characters.slice(0, middle).join("").trimEnd() + "…";

        if (ctx.measureText(candidate).width <= maxWidth) {
            low = middle;
        } else {
            high = middle - 1;
        }
    }

    return characters.slice(0, low).join("").trimEnd() + "…";
}

function wrapText(ctx, text, maxWidth, maxLines) {
    const words = text.trim().split(/\s+/u);
    const lines = [];
    let line = "";

    for (const word of words) {
        const testLine = line
            ? `${line} ${word}`
            : word;

        if (ctx.measureText(testLine).width <= maxWidth) {
            line = testLine;
            continue;
        }

        if (line) {
            lines.push(line);
            line = "";
        }

        if (lines.length === maxLines) {
            break;
        }

        // Split oversized words without separating emoji or combining marks.
        for (const { segment } of TEXT_SEGMENTER.segment(word)) {
            const candidate = line + segment;

            if (line && ctx.measureText(candidate).width > maxWidth) {
                lines.push(line);
                line = segment;

                if (lines.length === maxLines) {
                    break;
                }
            } else {
                line = candidate;
            }
        }

        if (lines.length === maxLines) {
            break;
        }
    }

    if (lines.length === maxLines) {
        lines[maxLines - 1] = ellipsizeText(
            ctx,
            lines[maxLines - 1],
            maxWidth,
            true,
        );
    } else if (line) {
        lines.push(line);
    }

    return lines;
}

function roundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();

    ctx.roundRect(
        x,
        y,
        width,
        height,
        radius,
    );

    ctx.closePath();
}

async function getThumbnailBuffer(path) {
    const url = new URL(
        path,
        CDN_ROOT,
    ).toString();

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(
            `Thumbnail fetch failed: ${response.status}`,
        );
    }

    return Buffer.from(
        await response.arrayBuffer(),
    );
}

export default async function buildVideoAnno(videoID) {
    try {
        const videoDoc = await MediaMeta
            .findById(videoID)
            .populate({
                path: "author",
                select: "username",
            })
            .lean();

        if (!videoDoc) {
            return null;
        }

        if(videoDoc.isPrivate) return "vid is priv";

        const videoURL =
            `https://www.pvpscalpel.com/watch/${videoDoc._id}`;

        const title =
            videoDoc.title?.trim() ||
            "New PvP Scalpel Video";

        const username =
            videoDoc.author?.username?.trim() ||
            "Unknown";

        // =========================
        // CANVAS
        // =========================

        const WIDTH = 1200;
        const HEIGHT = 1000;
        const contentX = 48;
        const contentWidth = WIDTH - contentX * 2;

        const canvas = createCanvas(
            WIDTH,
            HEIGHT,
        );

        const ctx = canvas.getContext("2d");

        // Background
        ctx.fillStyle = "#101114";
        ctx.fillRect(
            0,
            0,
            WIDTH,
            HEIGHT,
        );

        // Main card
        ctx.fillStyle = "#181a1f";

        roundedRect(
            ctx,
            24,
            24,
            WIDTH - 48,
            HEIGHT - 48,
            24,
        );

        ctx.fill();

        // =========================
        // HEADER
        // =========================

        ctx.fillStyle = "#72a7ff";
        ctx.font = `600 32px ${FONT_FAMILY}`;

        ctx.fillText(
            "PvP Scalpel TV",
            contentX,
            78,
        );

        ctx.fillStyle = "#888d97";
        ctx.font = `500 32px ${FONT_FAMILY}`;
        ctx.textAlign = "right";

        ctx.fillText(
            "NEW VIDEO",
            WIDTH - contentX,
            78,
        );

        ctx.textAlign = "left";

        // =========================
        // THUMBNAIL
        // =========================

        const thumbnailX = contentX;
        const thumbnailY = 104;

        const thumbnailWidth = contentWidth;
        const thumbnailHeight = 621;
        let thumbnail = null;

        if (videoDoc.manifest?.thumbnail) {
            try {
                const thumbnailBuffer = await getThumbnailBuffer(
                    videoDoc.manifest.thumbnail,
                );

                thumbnail = await loadImage(thumbnailBuffer);
            } catch (error) {
                console.error("Could not load video thumbnail:", error);
            }
        }

        ctx.save();

        roundedRect(
            ctx,
            thumbnailX,
            thumbnailY,
            thumbnailWidth,
            thumbnailHeight,
            18,
        );

        ctx.clip();

        if (thumbnail) {
            // Center-crop to cover the frame without stretching the image.
            const sourceRatio = thumbnail.width / thumbnail.height;
            const targetRatio = thumbnailWidth / thumbnailHeight;

            let sx = 0;
            let sy = 0;
            let sw = thumbnail.width;
            let sh = thumbnail.height;

            if (sourceRatio > targetRatio) {
                sw = thumbnail.height * targetRatio;
                sx = (thumbnail.width - sw) / 2;
            } else {
                sh = thumbnail.width / targetRatio;
                sy = (thumbnail.height - sh) / 2;
            }

            ctx.drawImage(
                thumbnail,
                sx,
                sy,
                sw,
                sh,
                thumbnailX,
                thumbnailY,
                thumbnailWidth,
                thumbnailHeight,
            );
        } else {
            ctx.fillStyle = "#24272d";
            ctx.fillRect(
                thumbnailX,
                thumbnailY,
                thumbnailWidth,
                thumbnailHeight,
            );
            ctx.fillStyle = "#aeb2ba";
            ctx.font = `40px ${FONT_FAMILY}`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(
                "Preview unavailable",
                thumbnailX + thumbnailWidth / 2,
                thumbnailY + thumbnailHeight / 2,
            );
        }

        ctx.restore();

        // Title
        ctx.fillStyle = "#ffffff";
        ctx.font = `700 60px ${FONT_FAMILY}`;

        const titleLines = wrapText(
            ctx,
            title,
            contentWidth,
            2,
        );

        let titleY = 794;

        for (const line of titleLines) {
            ctx.fillText(
                line,
                contentX,
                titleY,
            );

            titleY += 70;
        }

        // Author
        ctx.fillStyle = "#aeb2ba";
        ctx.font = `40px ${FONT_FAMILY}`;

        ctx.fillText(
            ellipsizeText(ctx, `By ${username}`, contentWidth),
            contentX,
            936,
        );

        // =========================
        // EXPORT
        // =========================

        const buffer =
            await canvas.encode("png");

        const attachment =
            new AttachmentBuilder(
                buffer,
                {
                    name: `pvp-scalpel-${videoDoc._id}.png`,
                },
            );

        // Canvas image itself isn't clickable,
        // so give Discord a proper link button.
        const watchButton =
            new ButtonBuilder()
                .setLabel("Watch Video")
                .setStyle(
                    ButtonStyle.Link,
                )
                .setURL(videoURL);

        const row =
            new ActionRowBuilder()
                .addComponents(
                    watchButton,
                );

        return {
            files: [
                attachment,
            ],
            components: [
                row,
            ],
        };
    } catch (error) {
        console.error(
            "Failed to build video announcement:",
            error,
        );

        return null;
    }
}
