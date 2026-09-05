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

function wrapText(ctx, text, maxWidth) {
    const words = text.split(" ");
    const lines = [];
    let line = "";

    for (const word of words) {
        const testLine = line
            ? `${line} ${word}`
            : word;

        if (ctx.measureText(testLine).width > maxWidth) {
            if (line) {
                lines.push(line);
            }

            line = word;
        } else {
            line = testLine;
        }
    }

    if (line) {
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

        const videoURL =
            `https://www.pvpscalpel.com/watch/${videoDoc._id}`;

        const title =
            videoDoc.title?.trim() ||
            "New PvP Scalpel Video";

        const description =
            videoDoc.description?.trim() ||
            "Fresh PvP content is now live.";

        const username =
            videoDoc.author?.username ||
            "Unknown";

        // =========================
        // CANVAS
        // =========================

        const WIDTH = 1200;
        const HEIGHT = 630;

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
            25,
            25,
            1150,
            580,
            24,
        );

        ctx.fill();

        // =========================
        // HEADER
        // =========================

        ctx.fillStyle = "#72a7ff";
        ctx.font = `600 25px ${FONT_FAMILY}`;

        ctx.fillText(
            "PVP SCALPEL",
            65,
            75,
        );

        ctx.fillStyle = "#888d97";
        ctx.font = `500 19px ${FONT_FAMILY}`;

        ctx.fillText(
            "NEW VIDEO",
            1020,
            75,
        );

        // =========================
        // THUMBNAIL
        // =========================

        const thumbnailX = 65;
        const thumbnailY = 110;

        const thumbnailWidth = 650;
        const thumbnailHeight = 410;

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

        if (videoDoc.manifest?.thumbnail) {
            try {
                const thumbnailBuffer =
                    await getThumbnailBuffer(
                        videoDoc.manifest.thumbnail,
                    );

                const thumbnail =
                    await loadImage(
                        thumbnailBuffer,
                    );

                /*
                 * Cover behavior:
                 * crop the image instead of stretching it.
                 */

                const sourceRatio =
                    thumbnail.width /
                    thumbnail.height;

                const targetRatio =
                    thumbnailWidth /
                    thumbnailHeight;

                let sx = 0;
                let sy = 0;
                let sw = thumbnail.width;
                let sh = thumbnail.height;

                if (sourceRatio > targetRatio) {
                    sw =
                        thumbnail.height *
                        targetRatio;

                    sx =
                        (thumbnail.width - sw) /
                        2;
                } else {
                    sh =
                        thumbnail.width /
                        targetRatio;

                    sy =
                        (thumbnail.height - sh) /
                        2;
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
            } catch (error) {
                console.error(
                    "Could not load video thumbnail:",
                    error,
                );

                ctx.fillStyle = "#24272d";

                ctx.fillRect(
                    thumbnailX,
                    thumbnailY,
                    thumbnailWidth,
                    thumbnailHeight,
                );

                ctx.fillStyle = "#777";
                ctx.font = `28px ${FONT_FAMILY}`;

                ctx.fillText(
                    "PvP Scalpel",
                    thumbnailX + 230,
                    thumbnailY + 210,
                );
            }
        }

        ctx.restore();

        // =========================
        // RIGHT SIDE INFO
        // =========================

        const contentX = 765;
        const contentWidth = 350;
        const uploaderY = 460;

        ctx.fillStyle = "#ffad32";
        ctx.font = `600 20px ${FONT_FAMILY}`;

        ctx.fillText(
            "NOW LIVE",
            contentX,
            140,
        );

        // Title
        ctx.fillStyle = "#ffffff";
        ctx.font = `700 34px ${FONT_FAMILY}`;

        const titleLines = wrapText(
            ctx,
            title,
            contentWidth,
        ).slice(0, 3);

        let titleY = 190;

        for (const line of titleLines) {
            ctx.fillText(
                line,
                contentX,
                titleY,
            );

            titleY += 42;
        }

        // Description
        ctx.fillStyle = "#aeb2ba";
        ctx.font = `20px ${FONT_FAMILY}`;

        const descriptionLines =
            wrapText(
                ctx,
                description,
                contentWidth,
            ).slice(0, 5);

        let descriptionY =
            titleY + 25;

        for (
            const line of descriptionLines
        ) {
            // Keep the full glyph height and a gap above the uploader box.
            const descent =
                ctx.measureText(line).actualBoundingBoxDescent;

            if (descriptionY + descent > uploaderY - 16) {
                break;
            }

            ctx.fillText(
                line,
                contentX,
                descriptionY,
            );

            descriptionY += 29;
        }

        // =========================
        // BOTTOM INFO
        // =========================

        ctx.fillStyle = "#25282f";

        roundedRect(
            ctx,
            contentX,
            uploaderY,
            contentWidth,
            70,
            14,
        );

        ctx.fill();

        ctx.fillStyle = "#888d97";
        ctx.font = `17px ${FONT_FAMILY}`;

        ctx.fillText(
            "UPLOADED BY",
            contentX + 20,
            uploaderY + 25,
        );

        ctx.fillStyle = "#ffffff";
        ctx.font = `600 23px ${FONT_FAMILY}`;

        ctx.fillText(
            username,
            contentX + 20,
            uploaderY + 55,
        );

        // Bottom branding
        ctx.fillStyle = "#666b75";
        ctx.font = `17px ${FONT_FAMILY}`;

        ctx.fillText(
            "PvP Scalpel TV",
            65,
            570,
        );

        ctx.textAlign = "right";

        ctx.fillText(
            "pvpscalpel.com",
            1115,
            570,
        );

        ctx.textAlign = "left";

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
