import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadImage } from "@napi-rs/canvas";
import GameClass from "../src/Models/GameClass.js";
import GameSpecialization from "../src/Models/GameSpecialization.js";
import generatePNotesSummaryCard, {
    calculateCardLayout,
    calculateSummaryStats,
    formatEffectiveDate,
} from "../src/services/Service-Helpers/CFPNotes/generatePNotesSummaryCard.js";

const ASSET_DIRECTORY = fileURLToPath(
    new URL(
        "../src/services/Service-Helpers/CFPNotes/canvaAssets/",
        import.meta.url,
    ),
);

const ANALYSIS = {
    changes: {
        classes: [[7, "nerf|bug_fix"]],
        specs: [[262, "nerf"]],
    },
    systemUpdated: false,
};

const POST = {
    id: 6350810,
    title: "Class Tuning Incoming – 1 September",
    createdAt: "2026-08-31T19:49:40.684Z",
};

const CLASSES = [
    {
        _id: 7,
        name: "Shaman",
        media: "https://assets.test/shared-icon.png",
    },
    {
        _id: 1,
        name: "Warrior",
        media: "https://assets.test/warrior.png",
    },
];

const SPECS = [
    {
        _id: 262,
        name: "Elemental",
        relClass: 7,
        media: "https://assets.test/shared-icon.png",
    },
];

function fakeQuery(rows, expectedSelection) {
    return {
        select(selection) {
            assert.equal(selection, expectedSelection);
            return this;
        },
        lean() {
            return Promise.resolve(rows);
        },
    };
}

function filterByQuery(rows, query) {
    const ids = query?._id?.$in;
    assert.ok(Array.isArray(ids));
    return rows.filter((entry) => ids.includes(entry._id));
}

function mockCardModels(t, classes = CLASSES, specs = SPECS) {
    const originalClassFind = GameClass.find;
    const originalSpecFind = GameSpecialization.find;

    t.after(() => {
        GameClass.find = originalClassFind;
        GameSpecialization.find = originalSpecFind;
    });

    GameClass.find = (query) => fakeQuery(
        filterByQuery(classes, query),
        "_id name media",
    );
    GameSpecialization.find = (query) => fakeQuery(
        filterByQuery(specs, query),
        "_id name media relClass",
    );
}

async function temporaryDirectory(t) {
    const directory = await mkdtemp(path.join(tmpdir(), "cfp-notes-card-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    return directory;
}

test("renders the Shaman summary as a timestamped 1536px PNG", async (t) => {
    mockCardModels(t);
    const outputDir = await temporaryDirectory(t);
    const iconBuffer = await readFile(path.join(ASSET_DIRECTORY, "ui/bug.png"));
    let fetchCalls = 0;

    const result = await generatePNotesSummaryCard(ANALYSIS, POST, {
        outputDir,
        now: new Date("2026-09-12T10:20:30.456Z"),
        fetchImpl: async () => {
            fetchCalls += 1;
            return new Response(iconBuffer, { status: 200 });
        },
    });

    assert.equal(result.width, 1536);
    assert.ok(result.height >= 1024);
    assert.equal(
        path.basename(result.path),
        "cfp-notes-6350810-20260912T102030456Z.png",
    );
    assert.equal(fetchCalls, 1, "duplicate media URLs should be fetched once");

    const png = await readFile(result.path);
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const decoded = await loadImage(png);
    assert.equal(decoded.width, 1536);
    assert.equal(decoded.height, result.height);
});

test("grows vertically when class and spec grids need additional rows", () => {
    const small = calculateCardLayout(ANALYSIS);
    const large = calculateCardLayout({
        changes: {
            classes: Array.from({ length: 7 }, (_, index) => [index + 1, "buff"]),
            specs: Array.from({ length: 19 }, (_, index) => [index + 100, "nerf"]),
        },
        systemUpdated: false,
    });

    assert.ok(small.height >= 1024);
    assert.equal(
        small.classSection.cards[0].x + small.classSection.cards[0].width / 2,
        1536 / 2,
    );
    assert.equal(
        small.specSection.cards[0].x + small.specSection.cards[0].width / 2,
        1536 / 2,
    );
    assert.ok(large.height > small.height);
    assert.equal(large.classSection.cards.length, 7);
    assert.equal(large.specSection.cards.length, 19);
    assert.equal(
        large.specSection.cards[0].y,
        large.specSection.cards[7].y,
        "the compact specialization grid should fit eight cards per row",
    );
    assert.ok(large.specSection.cards[8].y > large.specSection.cards[7].y);
});

test("keeps a full-data layout compact and centers incomplete rows", () => {
    const layout = calculateCardLayout({
        changes: {
            classes: Array.from({ length: 13 }, (_, index) => [index + 1, "buff"]),
            specs: Array.from({ length: 37 }, (_, index) => [index + 100, "nerf"]),
        },
        systemUpdated: false,
    });

    assert.ok(layout.height >= 2200 && layout.height <= 3000);

    const finalClassCard = layout.classSection.cards.at(-1);
    assert.equal(finalClassCard.x + finalClassCard.width / 2, 1536 / 2);

    const finalSpecRow = layout.specSection.cards.slice(32);
    const finalSpecRowLeft = finalSpecRow[0].x;
    const finalSpecRowRight = finalSpecRow.at(-1).x + finalSpecRow.at(-1).width;
    assert.equal((finalSpecRowLeft + finalSpecRowRight) / 2, 1536 / 2);
});

test("counts combined classifications in each applicable summary category", () => {
    assert.deepEqual(calculateSummaryStats({
        changes: {
            classes: [[7, "nerf|bug_fix"], [1, "buff"]],
            specs: [[262, "buff|bug_fix"], [71, "bug_fix"]],
        },
        systemUpdated: true,
    }), {
        affected: 4,
        classes: 2,
        specs: 2,
        buffs: 2,
        nerfs: 1,
        bugFixes: 3,
        systemUpdated: true,
    });
});

test("uses the effective title date and falls back to createdAt", () => {
    assert.equal(
        formatEffectiveDate(POST.title, POST.createdAt),
        "SEPTEMBER 1, 2026",
    );
    assert.equal(
        formatEffectiveDate(
            "Class Tuning Incoming",
            "2026-08-31T19:49:40.684Z",
        ),
        "AUGUST 31, 2026",
    );
});

test("renders system-only cards and survives unavailable remote icons", async (t) => {
    const outputDir = await temporaryDirectory(t);
    const systemOnly = {
        changes: { classes: [], specs: [] },
        systemUpdated: true,
    };

    const systemResult = await generatePNotesSummaryCard(systemOnly, POST, {
        outputDir,
        now: new Date("2026-09-12T10:20:30.000Z"),
        fetchImpl: async () => {
            throw new Error("fetch must not run without entries");
        },
    });
    assert.equal(systemResult.height, 1024);

    mockCardModels(t);
    const fallbackResult = await generatePNotesSummaryCard(ANALYSIS, POST, {
        outputDir,
        now: new Date("2026-09-12T10:20:31.000Z"),
        fetchImpl: async () => new Response("unavailable", { status: 503 }),
    });
    assert.equal((await loadImage(await readFile(fallbackResult.path))).width, 1536);
});

test("loads a specialization's parent class when no class card is present", async (t) => {
    mockCardModels(t);
    const outputDir = await temporaryDirectory(t);
    const specOnly = {
        changes: { classes: [], specs: [[262, "nerf"]] },
        systemUpdated: false,
    };

    const result = await generatePNotesSummaryCard(specOnly, POST, {
        outputDir,
        now: new Date("2026-09-12T10:20:32.000Z"),
        fetchImpl: async () => new Response("unavailable", { status: 503 }),
    });

    assert.equal(result.width, 1536);
});

test("rejects malformed analysis and missing database IDs", async (t) => {
    await assert.rejects(
        generatePNotesSummaryCard(
            {
                changes: { classes: [[7, "buff"], [7, "nerf"]], specs: [] },
                systemUpdated: false,
            },
            POST,
        ),
        /Duplicate classes ID 7/,
    );
    await assert.rejects(
        generatePNotesSummaryCard(
            {
                changes: { classes: [[7, "buff|nerf"]], specs: [] },
                systemUpdated: false,
            },
            POST,
        ),
        /invalid change type/,
    );

    mockCardModels(t, [], []);
    await assert.rejects(
        generatePNotesSummaryCard(
            {
                changes: { classes: [[999, "buff"]], specs: [] },
                systemUpdated: false,
            },
            POST,
            { fetchImpl: async () => new Response() },
        ),
        /Missing class IDs: 999/,
    );
});
