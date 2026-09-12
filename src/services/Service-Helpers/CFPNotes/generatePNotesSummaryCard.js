import { createCanvas, loadImage } from "@napi-rs/canvas";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import GameClass from "../../../Models/GameClass.js";
import GameSpecialization from "../../../Models/GameSpecialization.js";

const WIDTH = 1536;
const MIN_HEIGHT = 1024;
const ICON_TIMEOUT_MS = 10_000;
const CLASS_COLUMNS = 2;
const SPEC_COLUMNS = 8;
const CLASS_CARD_HEIGHT = 148;
const SPEC_CARD_HEIGHT = 228;
const STATS_Y = 218;
const STATS_HEIGHT = 138;
const GRID_GAP = 12;
const OUTER_MARGIN = 40;
const BUG_ICON_SCALE = 0.84;
const SERIF_FONT = '"DejaVu Serif", Georgia, serif';
const SANS_FONT = '"DejaVu Sans", Arial, sans-serif';

const CHANGE_TYPES = Object.freeze([
    "buff",
    "nerf",
    "bug_fix",
    "buff|bug_fix",
    "nerf|bug_fix",
]);

const ASSET_DIRECTORY = fileURLToPath(
    new URL("./canvaAssets/", import.meta.url),
);
const DEFAULT_OUTPUT_DIRECTORY = fileURLToPath(
    new URL("../../../../image_gen/", import.meta.url),
);

let staticAssetsPromise;

/**
 * @typedef {"buff"|"nerf"|"bug_fix"|"buff|bug_fix"|"nerf|bug_fix"} CardChangeType
 */

/**
 * @typedef {[number, CardChangeType]} CardChangeEntry
 */

/**
 * @typedef {Object} CardAnalysis
 * @property {{classes: CardChangeEntry[], specs: CardChangeEntry[]}} changes
 * @property {boolean} systemUpdated
 */

/**
 * Renders branded patch-note summary card and returns it's buffer.
 *
 * @param {CardAnalysis} analysis
 * @param {{id: number, title: string, createdAt: string}} post
 * @param {{
 *   outputDir?: string,
 *   fetchImpl?: typeof fetch,
 *   now?: Date
 * }} [options]
 * @returns {Promise<Buffer>} PNG image buffer.
*/
//  * @returns {Promise<{path: string, width: number, height: number}>}
export default async function generatePNotesSummaryCard(
    analysis,
    post,
    options = {},
) {
    const normalizedAnalysis = validateCardAnalysis(analysis);
    const normalizedPost = validateCardPost(post);
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
        throw new TypeError("A fetch implementation is required to load card icons");
    }

    const outputDirectory = readOutputDirectory(options.outputDir);
    const now = readNow(options.now);
    const assetsPromise = loadStaticAssets();
    const cardData = await resolveCardData(normalizedAnalysis);
    const iconCache = new Map();

    const [assets, classes, specs] = await Promise.all([
        assetsPromise,
        loadEntryIcons(cardData.classes, fetchImpl, iconCache),
        loadEntryIcons(cardData.specs, fetchImpl, iconCache),
    ]);

    const layout = calculateCardLayout(normalizedAnalysis);
    const canvas = createCanvas(WIDTH, layout.height);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    drawBackground(ctx, assets.background, layout.height);
    drawHeader(ctx, assets, normalizedPost);
    drawStats(ctx, assets, calculateSummaryStats(normalizedAnalysis));

    if (layout.classSection) {
        drawSectionHeading(ctx, "CLASS-WIDE CHANGES", layout.classSection.headingY);
        classes.forEach((entry, index) => {
            drawClassCard(ctx, assets, entry, layout.classSection.cards[index]);
        });
    }

    if (layout.specSection) {
        drawSectionHeading(ctx, "SPECIALIZATION CHANGES", layout.specSection.headingY);
        specs.forEach((entry, index) => {
            drawSpecCard(ctx, assets, entry, layout.specSection.cards[index]);
        });
    }

    if (layout.emptyState) {
        drawEmptyState(
            ctx,
            assets.frame,
            layout.emptyState,
            normalizedAnalysis.systemUpdated,
        );
    }

    drawFooter(ctx, layout.footerY);

    const buffer = await canvas.encode("png");
    return buffer
    // await mkdir(outputDirectory, { recursive: true });

    // const timestamp = now.toISOString().replace(/[-:.]/g, "");
    // const filename = `cfp-notes-${normalizedPost.id}-${timestamp}.png`;
    // const outputPath = path.join(outputDirectory, filename);
    // await writeFile(outputPath, buffer);

    // return {
    //     imgBuffer: buffer,
    //     width: WIDTH,
    //     height: layout.height,
    // };
}

/**
 * Calculates summary counters. Combined changes contribute to both categories.
 *
 * @param {CardAnalysis} analysis
 * @returns {{affected: number, classes: number, specs: number, buffs: number, nerfs: number, bugFixes: number, systemUpdated: boolean}}
 */
export function calculateSummaryStats(analysis) {
    const normalized = validateCardAnalysis(analysis);
    const entries = [
        ...normalized.changes.classes,
        ...normalized.changes.specs,
    ];

    return {
        affected: entries.length,
        classes: normalized.changes.classes.length,
        specs: normalized.changes.specs.length,
        buffs: entries.filter(([, change]) => change.includes("buff")).length,
        nerfs: entries.filter(([, change]) => change.includes("nerf")).length,
        bugFixes: entries.filter(([, change]) => change.includes("bug_fix")).length,
        systemUpdated: normalized.systemUpdated,
    };
}

/**
 * Calculates all card positions and the dynamic output height.
 *
 * @param {CardAnalysis} analysis
 * @returns {{
 *   height: number,
 *   classSection: null|{headingY: number, cards: Array<{x: number, y: number, width: number, height: number}>},
 *   specSection: null|{headingY: number, cards: Array<{x: number, y: number, width: number, height: number}>},
 *   emptyState: null|{x: number, y: number, width: number, height: number},
 *   footerY: number
 * }}
 */
export function calculateCardLayout(analysis) {
    const normalized = validateCardAnalysis(analysis);
    let cursorY = STATS_Y + STATS_HEIGHT + 18;
    let classSection = null;
    let specSection = null;
    let emptyState = null;

    if (normalized.changes.classes.length > 0) {
        const headingY = cursorY;
        cursorY += 42 + 8;
        const cards = buildGridRects(
            normalized.changes.classes.length,
            CLASS_COLUMNS,
            cursorY,
            CLASS_CARD_HEIGHT,
        );
        const rows = Math.ceil(normalized.changes.classes.length / CLASS_COLUMNS);
        cursorY += rows * CLASS_CARD_HEIGHT + Math.max(0, rows - 1) * GRID_GAP + 14;
        classSection = { headingY, cards };
    }

    if (normalized.changes.specs.length > 0) {
        const headingY = cursorY;
        cursorY += 42 + 8;
        const cards = buildGridRects(
            normalized.changes.specs.length,
            SPEC_COLUMNS,
            cursorY,
            SPEC_CARD_HEIGHT,
        );
        const rows = Math.ceil(normalized.changes.specs.length / SPEC_COLUMNS);
        cursorY += rows * SPEC_CARD_HEIGHT + Math.max(0, rows - 1) * GRID_GAP + 14;
        specSection = { headingY, cards };
    }

    if (!classSection && !specSection) {
        emptyState = {
            x: 280,
            y: cursorY + 24,
            width: WIDTH - 560,
            height: 210,
        };
        cursorY = emptyState.y + emptyState.height + 24;
    }

    const footerY = cursorY + 18;
    const height = Math.max(MIN_HEIGHT, Math.ceil(footerY + 34));

    return {
        height,
        classSection,
        specSection,
        emptyState,
        footerY,
    };
}

/**
 * Formats Blizzard's effective tuning date from the title, falling back to the
 * post creation timestamp.
 *
 * @param {string} title
 * @param {string} createdAt
 * @returns {string}
 */
export function formatEffectiveDate(title, createdAt) {
    const createdDate = new Date(createdAt);
    if (Number.isNaN(createdDate.getTime())) {
        throw new TypeError("post.createdAt must be a valid date");
    }

    const monthNames = [
        "january", "february", "march", "april", "may", "june",
        "july", "august", "september", "october", "november", "december",
    ];
    const monthPattern = monthNames.join("|");
    const dayFirst = new RegExp(
        `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPattern})(?:\\s*,?\\s*(\\d{4}))?\\b`,
        "i",
    ).exec(title);
    const monthFirst = new RegExp(
        `\\b(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(\\d{4}))?\\b`,
        "i",
    ).exec(title);

    let year = createdDate.getUTCFullYear();
    let month = createdDate.getUTCMonth();
    let day = createdDate.getUTCDate();

    if (dayFirst) {
        day = Number(dayFirst[1]);
        month = monthNames.indexOf(dayFirst[2].toLowerCase());
        year = Number(dayFirst[3] ?? year);
    } else if (monthFirst) {
        month = monthNames.indexOf(monthFirst[1].toLowerCase());
        day = Number(monthFirst[2]);
        year = Number(monthFirst[3] ?? year);
    }

    const effectiveDate = new Date(Date.UTC(year, month, day));
    if (
        effectiveDate.getUTCFullYear() !== year ||
        effectiveDate.getUTCMonth() !== month ||
        effectiveDate.getUTCDate() !== day
    ) {
        throw new TypeError("Post title contains an invalid effective date");
    }

    return new Intl.DateTimeFormat("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
    }).format(effectiveDate).toUpperCase();
}

async function resolveCardData(analysis) {
    const classChanges = new Map(analysis.changes.classes);
    const specChanges = new Map(analysis.changes.specs);
    const classIds = [...classChanges.keys()];
    const specIds = [...specChanges.keys()];

    const [directClassDocuments, specDocuments] = await Promise.all([
        findDocuments(
            GameClass,
            classIds,
            "_id name media",
        ),
        findDocuments(
            GameSpecialization,
            specIds,
            "_id name media relClass",
        ),
    ]);

    assertAllDocumentsFound(directClassDocuments, classIds, "class");
    assertAllDocumentsFound(specDocuments, specIds, "specialization");

    const directClassMap = mapDocumentsById(directClassDocuments, "class");
    const parentIds = [...new Set(specDocuments.map((entry) => entry.relClass))];
    const missingParentIds = parentIds.filter((id) => !directClassMap.has(id));
    const parentDocuments = await findDocuments(
        GameClass,
        missingParentIds,
        "_id name media",
    );
    assertAllDocumentsFound(parentDocuments, missingParentIds, "parent class");

    const classMap = new Map([
        ...directClassMap,
        ...mapDocumentsById(parentDocuments, "parent class"),
    ]);

    const classes = directClassDocuments
        .map((entry) => ({
            id: entry._id,
            name: readDocumentName(entry, "class"),
            media: readOptionalMedia(entry.media),
            change: classChanges.get(entry._id),
        }))
        .sort((a, b) => a.id - b.id);

    const specs = specDocuments
        .map((entry) => {
            const parentClass = classMap.get(entry.relClass);
            if (!parentClass) {
                throw new Error(
                    `Specialization ${entry._id} references missing class ${entry.relClass}`,
                );
            }

            return {
                id: entry._id,
                name: readDocumentName(entry, "specialization"),
                classId: entry.relClass,
                className: readDocumentName(parentClass, "parent class"),
                media: readOptionalMedia(entry.media),
                change: specChanges.get(entry._id),
            };
        })
        .sort((a, b) => a.classId - b.classId || a.id - b.id);

    return { classes, specs };
}

async function findDocuments(model, ids, selection) {
    if (ids.length === 0) return [];

    const documents = await model
        .find({ _id: { $in: ids } })
        .select(selection)
        .lean();

    if (!Array.isArray(documents)) {
        throw new TypeError("Card database query must return an array");
    }

    return documents;
}

function assertAllDocumentsFound(documents, requestedIds, label) {
    const foundIds = new Set(documents.map((entry) => entry?._id));
    const missingIds = requestedIds.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) {
        throw new Error(`Missing ${label} IDs: ${missingIds.join(", ")}`);
    }
}

function mapDocumentsById(documents, label) {
    const result = new Map();
    for (const entry of documents) {
        if (!Number.isSafeInteger(entry?._id) || entry._id <= 0) {
            throw new TypeError(`${label} document has an invalid _id`);
        }
        if (result.has(entry._id)) {
            throw new Error(`Duplicate ${label} document ID ${entry._id}`);
        }
        result.set(entry._id, entry);
    }
    return result;
}

async function loadStaticAssets() {
    if (!staticAssetsPromise) {
        staticAssetsPromise = Promise.all([
            loadLocalImage("backgroundCard.png"),
            loadLocalImage("headerLogo.png"),
            loadLocalImage("ui/image.png"),
            loadLocalImage("ui/arrow-up.png"),
            loadLocalImage("ui/arrow-down.png"),
            loadLocalImage("ui/bug.png"),
        ]).then(([
            background,
            logo,
            frame,
            arrowUp,
            arrowDown,
            bug,
        ]) => ({
            background,
            logo,
            frame,
            arrowUp,
            arrowDown,
            bug,
        }));
    }

    return staticAssetsPromise;
}

async function loadLocalImage(relativePath) {
    const buffer = await readFile(path.join(ASSET_DIRECTORY, relativePath));
    return loadImage(buffer);
}

async function loadEntryIcons(entries, fetchImpl, cache) {
    return Promise.all(entries.map(async (entry) => ({
        ...entry,
        icon: await loadRemoteIcon(entry.media, fetchImpl, cache),
    })));
}

async function loadRemoteIcon(url, fetchImpl, cache) {
    if (!url) return null;

    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

    if (!cache.has(url)) {
        cache.set(url, (async () => {
            try {
                const response = await fetchImpl(url, {
                    signal: AbortSignal.timeout(ICON_TIMEOUT_MS),
                });
                if (!response?.ok) return null;
                return await loadImage(Buffer.from(await response.arrayBuffer()));
            } catch {
                return null;
            }
        })());
    }

    return cache.get(url);
}

function drawBackground(ctx, background, height) {
    // Only stretch the quiet fabric/dark-center band below the Alliance
    // emblems. The previous split at y=360 cut through both emblems and
    // elongated their lower halves on tall cards.
    const sourceMiddleY = Math.round(background.height * 0.5);
    const sourceMiddleEndY = Math.round(background.height * 0.55);
    const topHeight = sourceMiddleY;
    const sourceMiddleHeight = sourceMiddleEndY - sourceMiddleY;
    const bottomHeight = background.height - sourceMiddleEndY;
    const destinationMiddleHeight = Math.max(
        1,
        height - topHeight - bottomHeight,
    );

    ctx.drawImage(
        background,
        0,
        0,
        background.width,
        topHeight,
        0,
        0,
        WIDTH,
        topHeight,
    );
    ctx.drawImage(
        background,
        0,
        sourceMiddleY,
        background.width,
        sourceMiddleHeight,
        0,
        topHeight,
        WIDTH,
        destinationMiddleHeight,
    );
    ctx.drawImage(
        background,
        0,
        background.height - bottomHeight,
        background.width,
        bottomHeight,
        0,
        height - bottomHeight,
        WIDTH,
        bottomHeight,
    );

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "rgba(1, 8, 15, 0.12)");
    gradient.addColorStop(0.3, "rgba(1, 8, 15, 0.42)");
    gradient.addColorStop(1, "rgba(0, 5, 10, 0.56)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, WIDTH, height);
}

function drawHeader(ctx, assets, post) {
    drawImageContain(ctx, assets.logo, 42, 12, 270, 180);

    const headerCenterX = WIDTH / 2;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#e5bd73";
    ctx.font = `500 23px ${SERIF_FONT}`;
    drawTrackedText(ctx, "WORLD OF WARCRAFT", headerCenterX, 38, 4);

    ctx.fillStyle = "#f3ead7";
    setFittedFont(ctx, "CLASS TUNING", 880, 64, 44, 700, SERIF_FONT);
    ctx.fillText("CLASS TUNING", headerCenterX, 106);

    ctx.fillStyle = "#d9c9ac";
    ctx.font = `500 28px ${SERIF_FONT}`;
    drawTrackedText(ctx, "QUICK OVERVIEW", headerCenterX, 143, 7);

    ctx.fillStyle = "#c8c5c0";
    ctx.font = `500 19px ${SANS_FONT}`;
    drawTrackedText(
        ctx,
        `RETAIL  •  ${formatEffectiveDate(post.title, post.createdAt)}`,
        headerCenterX,
        177,
        3,
    );
    ctx.textAlign = "left";
}

function drawStats(ctx, assets, stats) {
    const y = STATS_Y;
    const height = STATS_HEIGHT;
    const items = [
        { type: "buff", value: stats.buffs, label: "BUFFS", color: "#5dff85", icon: assets.arrowUp },
        { type: "nerf", value: stats.nerfs, label: "NERFS", color: "#ff6666", icon: assets.arrowDown },
        { type: "bug_fix", value: stats.bugFixes, label: "BUG FIXES", color: "#ffc83f", icon: assets.bug },
    ];
    const itemWidth = 300;
    const width = items.length * itemWidth + 64;
    const x = (WIDTH - width) / 2;

    ctx.textAlign = "center";
    ctx.fillStyle = "#9ca6b0";
    ctx.font = `600 12px ${SANS_FONT}`;
    drawTrackedText(
        ctx,
        `${stats.classes} ${pluralize(stats.classes, "CLASS", "CLASSES")}  •  ` +
            `${stats.specs} ${pluralize(stats.specs, "SPEC", "SPECS")} AFFECTED`,
        WIDTH / 2,
        y - 12,
        1.6,
    );

    drawPanel(ctx, assets.frame, x, y, width, height, 12);

    items.forEach((item, index) => {
        const itemX = x + 32 + itemWidth * index;
        if (index > 0) {
            ctx.strokeStyle = "rgba(207, 164, 84, 0.35)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(itemX, y + 26);
            ctx.lineTo(itemX, y + height - 26);
            ctx.stroke();
        }

        const centerX = itemX + itemWidth / 2;
        if (item.icon) {
            const iconBoxSize = 50;
            const iconSize = item.type === "bug_fix"
                ? iconBoxSize * BUG_ICON_SCALE
                : iconBoxSize;
            drawImageContain(
                ctx,
                item.icon,
                centerX - 69 + (iconBoxSize - iconSize) / 2,
                y + 29 + (iconBoxSize - iconSize) / 2,
                iconSize,
                iconSize,
            );
        }
        ctx.textAlign = "center";
        ctx.fillStyle = item.color;
        ctx.font = `700 39px ${SERIF_FONT}`;
        ctx.fillText(String(item.value), centerX + (item.icon ? 20 : 0), y + 67);
        ctx.fillStyle = "#bbc0c6";
        ctx.font = `600 14px ${SANS_FONT}`;
        drawTrackedText(ctx, item.label, centerX, y + 106, 1.8);
    });

    ctx.textAlign = "left";
}

function drawSectionHeading(ctx, text, y) {
    const centerX = WIDTH / 2;
    ctx.textAlign = "center";
    ctx.fillStyle = "#deb66f";
    ctx.font = `700 26px ${SERIF_FONT}`;
    drawTrackedText(ctx, text, centerX, y + 31, 3);

    ctx.strokeStyle = "rgba(214, 166, 78, 0.58)";
    ctx.lineWidth = 1;
    const textWidth = ctx.measureText(text).width + text.length * 3;
    ctx.beginPath();
    ctx.moveTo(OUTER_MARGIN, y + 23);
    ctx.lineTo(centerX - textWidth / 2 - 34, y + 23);
    ctx.moveTo(centerX + textWidth / 2 + 34, y + 23);
    ctx.lineTo(WIDTH - OUTER_MARGIN, y + 23);
    ctx.stroke();
    ctx.textAlign = "left";
}

function drawClassCard(ctx, assets, entry, rect) {
    drawPanel(ctx, assets.frame, rect.x, rect.y, rect.width, rect.height, 10);
    const insets = calculateFrameInsets(rect.width, rect.height);
    const innerTop = rect.y + insets.vertical;
    const innerBottom = rect.y + rect.height - insets.vertical;
    const innerWidth = rect.width - insets.horizontal * 2;
    const centerY = rect.y + rect.height / 2;
    const iconSize = Math.min(100, innerBottom - innerTop - 4);
    const indicatorHeight = 72;
    const statusAreaWidth = calculateChangeIndicatorsWidth(
        "buff|bug_fix",
        indicatorHeight,
    );
    const iconTextGap = 22;
    const textStatusGap = 22;
    const desiredTextWidth = 230;
    const desiredGroupWidth =
        iconSize + iconTextGap + desiredTextWidth + textStatusGap + statusAreaWidth;
    const groupWidth = Math.min(innerWidth - 8, desiredGroupWidth);
    const groupX = rect.x + (rect.width - groupWidth) / 2;
    const contentX = groupX + iconSize + iconTextGap;
    const indicatorX = groupX + groupWidth - statusAreaWidth;
    const contentWidth = Math.max(80, indicatorX - contentX - textStatusGap);

    drawCircularIcon(
        ctx,
        entry.icon,
        initials(entry.name),
        groupX,
        centerY - iconSize / 2,
        iconSize,
    );

    ctx.fillStyle = "#f2e4c9";
    ctx.textAlign = "left";
    setFittedFont(ctx, entry.name.toUpperCase(), contentWidth, 29, 20, 700, SERIF_FONT);
    ctx.fillText(entry.name.toUpperCase(), contentX, centerY - 4);
    ctx.fillStyle = "#c5a970";
    ctx.font = `600 15px ${SANS_FONT}`;
    drawTrackedText(ctx, "ALL SPECS", contentX, centerY + 24, 1.5);

    drawChangeBadges(
        ctx,
        assets,
        entry.change,
        indicatorX,
        centerY - indicatorHeight / 2,
        statusAreaWidth,
        indicatorHeight,
    );
}

function drawSpecCard(ctx, assets, entry, rect) {
    drawPanel(ctx, assets.frame, rect.x, rect.y, rect.width, rect.height, 10);
    const insets = calculateFrameInsets(rect.width, rect.height);
    const innerTop = rect.y + insets.vertical;
    const innerBottom = rect.y + rect.height - insets.vertical;
    const innerWidth = rect.width - insets.horizontal * 2;
    const iconSize = Math.min(84, innerWidth - 6);
    drawCircularIcon(
        ctx,
        entry.icon,
        initials(entry.name),
        rect.x + (rect.width - iconSize) / 2,
        innerTop,
        iconSize,
    );

    ctx.textAlign = "center";
    ctx.fillStyle = "#f2e4c9";
    setFittedFont(ctx, entry.name.toUpperCase(), innerWidth, 19, 13, 700, SERIF_FONT);
    ctx.fillText(
        entry.name.toUpperCase(),
        rect.x + rect.width / 2,
        innerTop + iconSize + 20,
    );
    ctx.fillStyle = "#c5a970";
    ctx.font = `600 11px ${SANS_FONT}`;
    drawTrackedText(
        ctx,
        entry.className.toUpperCase(),
        rect.x + rect.width / 2,
        innerTop + iconSize + 38,
        1.1,
    );

    drawChangeBadges(
        ctx,
        assets,
        entry.change,
        rect.x + insets.horizontal,
        innerBottom - 46,
        innerWidth,
        36,
    );
    ctx.textAlign = "left";
}

function drawChangeBadges(
    ctx,
    assets,
    change,
    x,
    y,
    availableWidth,
    height,
    alignment = "center",
) {
    const types = change.split("|");
    const gap = 14;
    const indicatorSize = Math.min(height, availableWidth);
    const totalWidth = indicatorSize * types.length +
        gap * Math.max(0, types.length - 1);
    let indicatorX = alignment === "right"
        ? x + Math.max(0, availableWidth - totalWidth - 8)
        : x + Math.max(0, (availableWidth - totalWidth) / 2);

    types.forEach((type) => {
        const visualSize = type === "bug_fix"
            ? indicatorSize * BUG_ICON_SCALE
            : indicatorSize;
        drawImageContain(
            ctx,
            changeIcon(type, assets),
            indicatorX + (indicatorSize - visualSize) / 2,
            y + (height - visualSize) / 2,
            visualSize,
            visualSize,
        );
        indicatorX += indicatorSize + gap;
    });
}

function calculateChangeIndicatorsWidth(change, indicatorSize) {
    const indicatorCount = change.split("|").length;
    return indicatorCount * indicatorSize + Math.max(0, indicatorCount - 1) * 14;
}

function changeIcon(type, assets) {
    if (type === "buff") return assets.arrowUp;
    if (type === "nerf") return assets.arrowDown;
    return assets.bug;
}

function drawEmptyState(ctx, frame, rect, systemUpdated) {
    drawPanel(ctx, frame, rect.x, rect.y, rect.width, rect.height, 12);
    ctx.textAlign = "center";
    ctx.fillStyle = systemUpdated ? "#f2d181" : "#d4d8dc";
    ctx.font = `700 31px ${SERIF_FONT}`;
    ctx.fillText(
        systemUpdated ? "PVP SYSTEMS UPDATED" : "NO PVP CHANGES DETECTED",
        rect.x + rect.width / 2,
        rect.y + 91,
    );
    ctx.fillStyle = "#939ca5";
    ctx.font = `500 17px ${SANS_FONT}`;
    ctx.fillText(
        systemUpdated
            ? "No class or specialization was directly affected."
            : "No active class, specialization, or system changes were found.",
        rect.x + rect.width / 2,
        rect.y + 128,
    );
    ctx.textAlign = "left";
}

function drawFooter(ctx, y) {
    ctx.strokeStyle = "rgba(205, 160, 78, 0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(OUTER_MARGIN, y - 14);
    ctx.lineTo(WIDTH - OUTER_MARGIN, y - 14);
    ctx.stroke();

    ctx.fillStyle = "#77818d";
    ctx.font = `500 13px ${SANS_FONT}`;
    ctx.textAlign = "left";
    drawTrackedText(ctx, "PVP SCALPEL  |  CLASS TUNING TRACKER", OUTER_MARGIN, y + 13, 2);
    ctx.textAlign = "right";
    drawTrackedText(
        ctx,
        "SOURCE: BLIZZARD ENTERTAINMENT",
        WIDTH - OUTER_MARGIN,
        y + 13,
        2,
    );
    ctx.textAlign = "left";
}

function drawPanel(ctx, frame, x, y, width, height, radius) {
    roundedRect(ctx, x + 7, y + 7, width - 14, height - 14, radius);
    ctx.fillStyle = "rgba(1, 10, 17, 0.86)";
    ctx.fill();
    drawNineSliceFrame(ctx, frame, x, y, width, height);
}

function drawNineSliceFrame(ctx, image, x, y, width, height) {
    const sourceX = 180;
    const sourceY = 180;
    const insets = calculateFrameInsets(width, height);
    const destinationX = insets.horizontal;
    const destinationY = insets.vertical;
    const sourceMiddleWidth = image.width - sourceX * 2;
    const sourceMiddleHeight = image.height - sourceY * 2;
    const destinationMiddleWidth = width - destinationX * 2;
    const destinationMiddleHeight = height - destinationY * 2;

    const columns = [
        [0, sourceX, x, destinationX],
        [sourceX, sourceMiddleWidth, x + destinationX, destinationMiddleWidth],
        [image.width - sourceX, sourceX, x + width - destinationX, destinationX],
    ];
    const rows = [
        [0, sourceY, y, destinationY],
        [sourceY, sourceMiddleHeight, y + destinationY, destinationMiddleHeight],
        [image.height - sourceY, sourceY, y + height - destinationY, destinationY],
    ];

    for (const [sourceLeft, sourceWidth, destinationLeft, destinationWidth] of columns) {
        for (const [sourceTop, sourceHeight, destinationTop, destinationHeight] of rows) {
            ctx.drawImage(
                image,
                sourceLeft,
                sourceTop,
                sourceWidth,
                sourceHeight,
                destinationLeft,
                destinationTop,
                destinationWidth,
                destinationHeight,
            );
        }
    }
}

function calculateFrameInsets(width, height) {
    return {
        horizontal: Math.max(26, Math.min(46, Math.round(width * 0.06))),
        vertical: Math.max(18, Math.min(28, Math.round(height * 0.12))),
    };
}

function pluralize(value, singular, plural) {
    return value === 1 ? singular : plural;
}

function drawCircularIcon(ctx, image, fallbackText, x, y, size) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2 - 4, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    const gradient = ctx.createRadialGradient(
        x + size / 2,
        y + size / 2,
        4,
        x + size / 2,
        y + size / 2,
        size / 2,
    );
    gradient.addColorStop(0, "#18324a");
    gradient.addColorStop(1, "#02070c");
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, size, size);

    if (image) {
        drawImageCover(ctx, image, x, y, size, size);
    } else {
        ctx.fillStyle = "#e4c47e";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `700 ${Math.round(size * 0.34)}px ${SERIF_FONT}`;
        ctx.fillText(fallbackText, x + size / 2, y + size / 2 + 1);
    }
    ctx.restore();

    ctx.strokeStyle = "#d9ad5e";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2 - 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(150, 210, 255, 0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2 - 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
}

function drawImageCover(ctx, image, x, y, width, height) {
    const sourceRatio = image.width / image.height;
    const destinationRatio = width / height;
    let sourceX = 0;
    let sourceY = 0;
    let sourceWidth = image.width;
    let sourceHeight = image.height;

    if (sourceRatio > destinationRatio) {
        sourceWidth = image.height * destinationRatio;
        sourceX = (image.width - sourceWidth) / 2;
    } else {
        sourceHeight = image.width / destinationRatio;
        sourceY = (image.height - sourceHeight) / 2;
    }

    ctx.drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        x,
        y,
        width,
        height,
    );
}

function drawImageContain(ctx, image, x, y, width, height) {
    const scale = Math.min(width / image.width, height / image.height);
    const destinationWidth = image.width * scale;
    const destinationHeight = image.height * scale;
    ctx.drawImage(
        image,
        x + (width - destinationWidth) / 2,
        y + (height - destinationHeight) / 2,
        destinationWidth,
        destinationHeight,
    );
}

function buildGridRects(count, columns, y, height) {
    const width =
        (WIDTH - OUTER_MARGIN * 2 - GRID_GAP * (columns - 1)) / columns;

    return Array.from({ length: count }, (_, index) => {
        const row = Math.floor(index / columns);
        const column = index % columns;
        const entriesBeforeRow = row * columns;
        const entriesInRow = Math.min(columns, count - entriesBeforeRow);
        const rowWidth = entriesInRow * width +
            Math.max(0, entriesInRow - 1) * GRID_GAP;
        const rowStartX = (WIDTH - rowWidth) / 2;

        return {
            x: rowStartX + column * (width + GRID_GAP),
            y: y + row * (height + GRID_GAP),
            width,
            height,
        };
    });
}

function setFittedFont(ctx, text, maxWidth, initialSize, minimumSize, weight, family) {
    let size = initialSize;
    do {
        ctx.font = `${weight} ${size}px ${family}`;
        if (ctx.measureText(text).width <= maxWidth) break;
        size -= 1;
    } while (size > minimumSize);
}

function drawTrackedText(ctx, text, centerOrStartX, y, spacing) {
    const characters = [...text];
    const widths = characters.map((character) => ctx.measureText(character).width);
    const totalWidth = widths.reduce((sum, width) => sum + width, 0) +
        Math.max(0, characters.length - 1) * spacing;
    let x = centerOrStartX;

    if (ctx.textAlign === "center") x -= totalWidth / 2;
    if (ctx.textAlign === "right") x -= totalWidth;

    const previousAlignment = ctx.textAlign;
    ctx.textAlign = "left";
    characters.forEach((character, index) => {
        ctx.fillText(character, x, y);
        x += widths[index] + spacing;
    });
    ctx.textAlign = previousAlignment;
}

function roundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    ctx.closePath();
}

function initials(name) {
    return name
        .trim()
        .split(/\s+/u)
        .slice(0, 2)
        .map((part) => [...part][0]?.toUpperCase() ?? "")
        .join("");
}

function validateCardAnalysis(analysis) {
    assertPlainObject(analysis, "analysis");
    assertExactKeys(analysis, ["changes", "systemUpdated"], "analysis");
    assertPlainObject(analysis.changes, "analysis.changes");
    assertExactKeys(
        analysis.changes,
        ["classes", "specs"],
        "analysis.changes",
    );
    if (typeof analysis.systemUpdated !== "boolean") {
        throw new TypeError("analysis.systemUpdated must be a boolean");
    }

    return {
        changes: {
            classes: validateEntries(analysis.changes.classes, "classes"),
            specs: validateEntries(analysis.changes.specs, "specs"),
        },
        systemUpdated: analysis.systemUpdated,
    };
}

function validateEntries(entries, label) {
    if (!Array.isArray(entries)) {
        throw new TypeError(`analysis.changes.${label} must be an array`);
    }

    const seenIds = new Set();
    return entries.map((entry) => {
        if (!Array.isArray(entry) || entry.length !== 2) {
            throw new TypeError(`${label} entries must be [id, change] tuples`);
        }
        const [id, change] = entry;
        if (!Number.isSafeInteger(id) || id <= 0) {
            throw new TypeError(`${label} entry ID must be a positive integer`);
        }
        if (!CHANGE_TYPES.includes(change)) {
            throw new TypeError(`${label} ID ${id} has an invalid change type`);
        }
        if (seenIds.has(id)) {
            throw new Error(`Duplicate ${label} ID ${id}`);
        }
        seenIds.add(id);
        return [id, change];
    });
}

function validateCardPost(post) {
    assertPlainObject(post, "post");
    if (!Number.isSafeInteger(post.id) || post.id <= 0) {
        throw new TypeError("post.id must be a positive integer");
    }
    const title = readNonEmptyString(post.title, "post.title");
    const createdAt = readNonEmptyString(post.createdAt, "post.createdAt");
    if (Number.isNaN(new Date(createdAt).getTime())) {
        throw new TypeError("post.createdAt must be a valid date");
    }
    return { id: post.id, title, createdAt };
}

function readOutputDirectory(value) {
    if (typeof value === "undefined") return DEFAULT_OUTPUT_DIRECTORY;
    return path.resolve(readNonEmptyString(value, "options.outputDir"));
}

function readNow(value) {
    if (typeof value === "undefined") return new Date();
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
        throw new TypeError("options.now must be a valid Date");
    }
    return new Date(value);
}

function readDocumentName(entry, label) {
    return readNonEmptyString(entry?.name, `${label} document name`);
}

function readOptionalMedia(value) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNonEmptyString(value, label) {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new TypeError(`${label} must be a non-empty string`);
    }
    return value.trim();
}

function assertPlainObject(value, label) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError(`${label} must be an object`);
    }
}

function assertExactKeys(value, expectedKeys, label) {
    const actualKeys = Object.keys(value).sort();
    const sortedExpectedKeys = [...expectedKeys].sort();
    if (
        actualKeys.length !== sortedExpectedKeys.length ||
        actualKeys.some((key, index) => key !== sortedExpectedKeys[index])
    ) {
        throw new TypeError(`${label} has missing or unexpected fields`);
    }
}
