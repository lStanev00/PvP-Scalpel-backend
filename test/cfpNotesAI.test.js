import assert from "node:assert/strict";
import test from "node:test";
import GameClass from "../src/Models/GameClass.js";
import GameSpecialization from "../src/Models/GameSpecialization.js";
import analyzePNotes, {
    annotatePNotesScopes,
    analyzePNotesContext,
    buildPNotesAIContext,
    groundBugFixClassifications,
    validatePNotesAnalysis,
} from "../src/services/Service-Helpers/CFPNotes/analyzePNotes.js";
import {
    htmlToText,
} from "../src/services/Service-Helpers/CFPNotes/getPostContent.js";

const CLASSES = [
    { _id: 7, name: "Shaman", media: "not-sent" },
    { _id: 1, name: "Warrior", media: "not-sent" },
];

const SPECS = [
    {
        _id: 262,
        name: "Elemental",
        relClass: 7,
        role: "damage",
        media: "not-sent",
    },
    {
        _id: 71,
        name: "Arms",
        relClass: 1,
        role: "damage",
        media: "not-sent",
    },
];

const POST = {
    id: 6350810,
    title: "Class Tuning Incoming - 1 September",
    content: "Classes\n\nShaman\nNatural Harmony was corrected.",
    html: "<p>not sent</p>",
    author: "not sent",
};

const EXPECTED_ANALYSIS = {
    changes: {
        classes: [[7, "nerf|bug_fix"]],
        specs: [[262, "nerf"]],
    },
    systemUpdated: false,
};

function successfulResponse(analysis = EXPECTED_ANALYSIS) {
    return new Response(
        JSON.stringify({
            message: {
                content: JSON.stringify(analysis),
            },
        }),
        {
            status: 200,
            headers: {
                "Content-Type": "application/json",
            },
        },
    );
}

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

test("loads minimal class/spec context and returns the validated Shaman analysis", async (t) => {
    const originalClassFind = GameClass.find;
    const originalSpecFind = GameSpecialization.find;
    const originalFetch = globalThis.fetch;
    let requestBody;

    t.after(() => {
        GameClass.find = originalClassFind;
        GameSpecialization.find = originalSpecFind;
        globalThis.fetch = originalFetch;
    });

    GameClass.find = () => fakeQuery(CLASSES, "_id name");
    GameSpecialization.find = () => fakeQuery(SPECS, "_id name relClass");
    globalThis.fetch = async (url, options) => {
        assert.equal(url, "http://localhost:11434/api/chat");
        assert.equal(options.method, "POST");
        assert.equal(options.headers["Content-Type"], "application/json");
        assert.ok(options.signal instanceof AbortSignal);
        requestBody = JSON.parse(options.body);
        return successfulResponse();
    };

    const result = await analyzePNotes(POST);

    assert.deepEqual(result, EXPECTED_ANALYSIS);
    assert.equal(requestBody.model, "qwen3:8b");
    assert.equal(requestBody.stream, false);
    assert.equal(requestBody.think, false);
    assert.equal(requestBody.options.temperature, 0);
    assert.equal(requestBody.options.num_ctx, 8192);
    assert.match(requestBody.messages[0].content, /general "Classes" section/);
    assert.match(requestBody.messages[0].content, /not going out/);
    assert.match(requestBody.messages[0].content, /systemUpdated is true only/);
    assert.match(
        requestBody.messages[0].content,
        /Class > Hero Talents > Hero tree > change.*class entry/s,
    );

    const userPrompt = requestBody.messages[1].content;
    const sentContext = JSON.parse(userPrompt.slice(userPrompt.indexOf("\n") + 1));
    assert.deepEqual(sentContext, {
        post: {
            title: POST.title,
            content: POST.content,
        },
        classes: [
            { id: 1, name: "Warrior" },
            { id: 7, name: "Shaman" },
        ],
        specs: [
            { id: 71, name: "Arms", classId: 1 },
            { id: 262, name: "Elemental", classId: 7 },
        ],
    });
    assert.deepEqual(Object.keys(requestBody.format).sort(), [
        "additionalProperties",
        "properties",
        "required",
        "type",
    ]);
});

test("marks strikethrough and deleted forum text as withdrawn", () => {
    const text = htmlToText(
        "<p>Active <s>cancelled healing change</s>.</p>" +
            "<p><del>Removed cooldown change</del></p>",
    );

    assert.match(
        text,
        /Active \[WITHDRAWN\] cancelled healing change \[\/WITHDRAWN\]\./,
    );
    assert.match(
        text,
        /\[WITHDRAWN\] Removed cooldown change \[\/WITHDRAWN\]/,
    );
    assert.doesNotMatch(text, /<\/?(?:s|del)>/);
});

test("preserves nested forum-list hierarchy for class and spec mapping", () => {
    const text = htmlToText(
        "<ul><li><strong>Shaman</strong><ul>" +
            "<li><strong>Hero Talents</strong><ul>" +
            "<li><strong>Farseer</strong><ul>" +
            "<li>Fixed an issue.</li>" +
            "</ul></li></ul></li></ul></li></ul>",
    );

    assert.match(
        text,
        /• Shaman\n\s*• Hero Talents\n\s*• Farseer\n\s*• Fixed an issue\./,
    );
    assert.match(text, /\n  • Hero Talents/);
    assert.match(text, /\n    • Farseer/);
    assert.match(text, /\n      • Fixed an issue\./);
});

test("annotates nested bullets with independent class and spec IDs", () => {
    const annotated = annotatePNotesScopes(
        [
            "Classes",
            "",
            "• Shaman",
            "  • Hero Talents",
            "    • Farseer",
            "      • Fixed an issue.",
            "",
            "Player versus Player",
            "",
            "• Shaman",
            "  • Elemental",
            "    • Farseer: Cooldown reduced.",
        ].join("\n"),
        CLASSES.map(({ _id: id, name }) => ({ id, name })),
        SPECS.map(({ _id: id, name, relClass: classId }) => ({
            id,
            name,
            classId,
        })),
    );

    assert.match(
        annotated,
        /\[TARGET classId=7\] Fixed an issue\./,
    );
    assert.match(
        annotated,
        /\[TARGET specId=262\] Farseer: Cooldown reduced\./,
    );
    assert.doesNotMatch(
        annotated,
        /\[TARGET specId=262\] Fixed an issue\./,
    );
});

test("keeps bug fixes grounded to active text for the exact target", () => {
    const content = [
        "• [TARGET classId=7] Shaman",
        "  • [TARGET classId=7] Fixed an issue that caused excess healing.",
        "• [TARGET specId=262] Elemental",
        "  • [TARGET specId=262] Cooldown reduction is 10 seconds (was 15).",
        "• [TARGET classId=1] Warrior",
        "  • [TARGET classId=1] [WITHDRAWN] Fixed an issue. [/WITHDRAWN]",
    ].join("\n");

    assert.deepEqual(
        groundBugFixClassifications(
            {
                changes: {
                    classes: [[7, "nerf|bug_fix"], [1, "bug_fix"]],
                    specs: [[262, "nerf|bug_fix"]],
                },
                systemUpdated: false,
            },
            content,
        ),
        {
            changes: {
                classes: [[7, "nerf|bug_fix"]],
                specs: [[262, "nerf"]],
            },
            systemUpdated: false,
        },
    );
});

test("builds sorted context without post or database metadata", () => {
    const context = buildPNotesAIContext(POST, CLASSES, SPECS);

    assert.deepEqual(Object.keys(context.post).sort(), ["content", "title"]);
    assert.deepEqual(context.classes.map(({ id }) => id), [1, 7]);
    assert.deepEqual(context.specs.map(({ id }) => id), [71, 262]);
    assert.equal("media" in context.classes[0], false);
    assert.equal("role" in context.specs[0], false);
});

test("accepts empty grouped changes and a PvP system update", () => {
    const context = buildPNotesAIContext(POST, CLASSES, SPECS);

    assert.deepEqual(
        validatePNotesAnalysis(
            {
                changes: {
                    classes: [],
                    specs: [],
                },
                systemUpdated: true,
            },
            context,
        ),
        {
            changes: {
                classes: [],
                specs: [],
            },
            systemUpdated: true,
        },
    );
});

test("rejects malformed, duplicate, invented, and misplaced AI changes", () => {
    const context = buildPNotesAIContext(POST, CLASSES, SPECS);
    const invalidResults = [
        {
            ...EXPECTED_ANALYSIS,
            unexpected: true,
        },
        {
            changes: {
                classes: [[7, "buff", "class"]],
                specs: [],
            },
            systemUpdated: false,
        },
        {
            changes: {
                classes: [[7, "buff|nerf"]],
                specs: [],
            },
            systemUpdated: false,
        },
        {
            changes: {
                classes: [[7, "buff"], [7, "nerf"]],
                specs: [],
            },
            systemUpdated: false,
        },
        {
            changes: {
                classes: [[999, "buff"]],
                specs: [],
            },
            systemUpdated: false,
        },
        {
            changes: {
                classes: [[262, "buff"]],
                specs: [],
            },
            systemUpdated: false,
        },
        {
            changes: {
                classes: [],
                specs: [[7, "buff"]],
            },
            systemUpdated: false,
        },
        {
            changes: {
                classes: [],
                specs: [],
                systems: [],
            },
            systemUpdated: false,
        },
        {
            changes: {
                classes: [],
                specs: [],
            },
            systemUpdated: "false",
        },
    ];

    for (const result of invalidResults) {
        assert.throws(() => validatePNotesAnalysis(result, context));
    }
});

test("rejects invalid database context before calling Ollama", () => {
    assert.throws(
        () => buildPNotesAIContext(POST, CLASSES, [
            { _id: 262, name: "Elemental", relClass: 999 },
        ]),
        /references unknown class ID 999/,
    );
    assert.throws(
        () => buildPNotesAIContext(POST, [], SPECS),
        /requires at least one class/,
    );
});

test("reports Ollama HTTP and JSON response failures", async () => {
    const context = buildPNotesAIContext(POST, CLASSES, SPECS);

    await assert.rejects(
        analyzePNotesContext(context, {
            fetchImpl: async () => new Response("service unavailable", {
                status: 503,
                statusText: "Service Unavailable",
            }),
            timeoutMs: 100,
        }),
        /HTTP 503 Service Unavailable: service unavailable/,
    );

    await assert.rejects(
        analyzePNotesContext(context, {
            fetchImpl: async () => ({
                ok: true,
                json: async () => {
                    throw new SyntaxError("bad response");
                },
            }),
            timeoutMs: 100,
        }),
        /response was not valid JSON/,
    );

    await assert.rejects(
        analyzePNotesContext(context, {
            fetchImpl: async () => new Response(
                JSON.stringify({ message: { content: "{" } }),
                { status: 200 },
            ),
            timeoutMs: 100,
        }),
        /analysis was not valid JSON/,
    );
});

test("aborts an Ollama request after the configured timeout", async () => {
    const context = buildPNotesAIContext(POST, CLASSES, SPECS);

    await assert.rejects(
        analyzePNotesContext(context, {
            fetchImpl: async (_url, { signal }) => new Promise((resolve, reject) => {
                signal.addEventListener("abort", () => reject(signal.reason), {
                    once: true,
                });
            }),
            timeoutMs: 5,
        }),
        /timed out after 5ms/,
    );
});
