import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { htmlToText } from "../src/services/Service-Helpers/CFPNotes/getPostContent.js";
import {
    analyzePNotesContext, buildPNotesAIContext, PNotesValidationError,
    validatePNotesAnalysis, validatePNotesEvidence,
} from "../src/services/Service-Helpers/CFPNotes/analyzePNotes.js";
import { classes, specs } from "./fixtures/cfpNotesTargets.js";

const posts = JSON.parse(readFileSync(new URL("./fixtures/cfpNotesPosts.json", import.meta.url)));
const result = (classEntries = [], specEntries = []) => ({
    changes: { classes: classEntries, specs: specEntries }, systemUpdated: false,
});
const contextForHTML = html => buildPNotesAIContext({ title: "Class Tuning", content: htmlToText(html) }, classes, specs);
const contextFor = id => contextForHTML(posts.find(post => post.id === id).html);
const check = (analysis, context) => validatePNotesEvidence(validatePNotesAnalysis(analysis, context), context);
const september22 = result([[5, "buff"]], [
    [250, "mixed"], [252, "buff"], [577, "buff"], [581, "buff"],
    [105, "nerf|bug_fix"], [1473, "buff"], [254, "buff"], [255, "mixed"],
    [63, "mixed"], [64, "buff"], [70, "buff"], [256, "buff"], [258, "buff"],
    [72, "buff"], [73, "buff"], [103, "buff"], [1468, "nerf"], [253, "buff"],
    [269, "mixed"], [257, "buff"], [259, "nerf"], [260, "buff"], [262, "mixed"],
    [263, "buff"], [265, "buff"], [71, "buff"],
]);

test("September 22 preserves paragraph-wrapped headings, scope, and eligible coverage", () => {
    const context = contextFor(6377649);
    assert.match(context.post.content, /• \[TARGET specId=250\] Blood/);
    assert.match(context.post.content, /\[TARGET classId=5\] Mindgames direct damage/);
    assert.match(context.post.content, /\[TARGET specId=105\] Fixed an issue where Photosynthesis/);
    assert.deepEqual(check(september22, context), september22);
    // Reprocessing is deterministic and never mutates the fixture or AI answer.
    for (let i = 0; i < 3; i++) {
        assert.deepEqual(contextFor(6377649), context);
        assert.deepEqual(check(september22, contextFor(6377649)), september22);
    }
});

test("September 22 rejects excluded, unmentioned, and false class-wide targets", () => {
    const context = contextFor(6377649);
    for (const id of [251, 1480, 1467, 264, 266, 267, 268, 270, 261]) {
        const invalid = structuredClone(september22);
        invalid.changes.specs.push([id, "buff"]);
        assert.throws(() => check(invalid, context), /Unsupported target/);
    }
    for (const id of [6, 8, 11, 12, 13]) {
        const invalid = structuredClone(september22);
        invalid.changes.classes.push([id, "buff"]);
        assert.throws(() => check(invalid, context), /Unsupported target/);
    }
});

test("September 22 requires Restoration fixes, Preservation nerf, Priest and Warrior/Ret changes", () => {
    const context = contextFor(6377649);
    for (const id of [105, 1468, 71, 72, 73, 70]) {
        const invalid = structuredClone(september22);
        invalid.changes.specs = invalid.changes.specs.filter(([specId]) => specId !== id);
        assert.throws(() => check(invalid, context), /Missing target/);
    }
    const noPriest = structuredClone(september22);
    noPriest.changes.classes = [];
    assert.throws(() => check(noPriest, context), /Missing target: Priest \(classId:5\)/);
    const noFix = structuredClone(september22);
    noFix.changes.specs.find(([id]) => id === 105)[1] = "nerf";
    assert.throws(() => check(noFix, context), /missing bug_fix/);
    const wrongRestoration = structuredClone(september22);
    wrongRestoration.changes.specs.find(([id]) => id === 105)[1] = "buff|bug_fix";
    assert.throws(() => check(wrongRestoration, context), /Restoration.*expected nerf/);
    const wrongDirection = structuredClone(september22);
    wrongDirection.changes.specs.find(([id]) => id === 1468)[1] = "buff";
    assert.throws(() => check(wrongDirection, context), /Preservation.*expected nerf/);
});

for (const [id, expected] of [
    [6350810, result([[7, "nerf|bug_fix"]], [[262, "nerf"]])],
    [6345800, result([], [[63, "nerf"], [71, "nerf"]])],
    [6340478, result([], [[256, "nerf"]])],
    [6340573, result()],
]) {
    test(`staff reply ${id} is analyzed independently, including exclusions and withdrawn clauses`, () => {
        assert.deepEqual(check(expected, contextFor(id)), expected);
        assert.deepEqual(check(expected, contextFor(id)), expected);
    });
}

test("September 1 partial withdrawal retains cooldown nerf without copying the class bug fix", () => {
    const context = contextFor(6350810);
    assert.match(context.post.content, /\[TARGET specId=262\].*10 seconds.*\[WITHDRAWN\].*healing.*\[\/WITHDRAWN\]/);
    assert.throws(() => check(result([[7,"nerf|bug_fix"]], [[262,"nerf|bug_fix"]]), context), /unsupported bug_fix/);
    assert.throws(() => check(result([[7,"nerf|bug_fix"]], [[262,"buff"]]), context), /expected nerf/);
    assert.throws(() => check(result([[7,"buff|bug_fix"]], [[262,"nerf"]]), context), /expected nerf/);
});

test("headings, developer notes, and fully withdrawn changes do not qualify as evidence", () => {
    const context = contextForHTML(`<h2>Classes</h2><p>Shaman</p><ul>
      <li>Developers’ notes: We fixed an issue and increased healing by 20%.</li>
      <li><s>Fixed an issue with healing.</s></li><li><del>Damage increased by 10%.</del></li>
      <li>This damage increase is not going out.</li></ul>`);
    assert.deepEqual(check(result(), context), result());
    assert.throws(() => check(result([[7,"buff|bug_fix"]]), context), /Unsupported target/);
});

test("whitespace, continuations, standalone Hero Talents, repeated spec names, and section resets", () => {
    const context = contextForHTML(`<p> DEATH   KNIGHT </p><ul><li><p>Frost</p>
      <ul><li><p>Damage increased by 5%.</p><p>Healing increased by 10%.</p></li></ul></li></ul>
      <p>Mage</p><ul><li><h3>Frost</h3><ul><li>Damage reduced by 5%.</li></ul></li></ul>
      <p>Paladin</p><ul><li>Holy<ul><li>Healing increased by 5%.</li></ul></li>
      <li>Protection<ul><li>Damage increased by 5%.</li></ul></li></ul>
      <p>Warrior</p><ul><li>Protection<ul><li>Damage reduced by 5%.</li></ul></li></ul>
      <p>Druid</p><ul><li>Restoration<ul><li>Healing increased by 5%.</li></ul></li></ul>
      <p>Shaman</p><h3>Hero Talents</h3><h4>Farseer</h4><ul><li>Damage increased by 5%.</li></ul>
      <ul><li>Restoration<ul><li>Healing reduced by 5%.</li></ul></li></ul>
      <h2>Player versus Player</h2><p>Priest</p><ul><li>Holy<ul><li>Healing reduced by 5%.</li></ul></li></ul>
      <h2>Items</h2><ul><li>PvP trinket damage increased by 10%.</li></ul>`);
    assert.match(context.post.content, /specId=251\] Damage increased by 5%. Healing increased by 10%/);
    assert.doesNotMatch(context.post.content, /TARGET[^\n]*PvP trinket/);
    const expected = result([[7,"buff"]], [[251,"buff"],[64,"nerf"],[65,"buff"],[66,"buff"],
        [73,"nerf"],[105,"buff"],[264,"nerf"],[257,"nerf"]]);
    expected.systemUpdated = true;
    assert.deepEqual(check(expected, context), expected);
});

test("quantified mixed effects require mixed; clear one-way direction cannot be reversed", () => {
    const context = contextForHTML(`<p>Shaman</p><ul><li>Elemental<ul>
      <li>Damage increased by 20%.</li><li>Healing reduced by 10%.</li></ul></li></ul>`);
    assert.doesNotThrow(() => check(result([], [[262, "mixed"]]), context));
    for (const label of ["buff","nerf"]) {
        assert.throws(() => check(result([], [[262,label]]), context), /expected mixed/);
    }
    for (const [change, expected] of [
        ["Damage increased by 20%.","buff"], ["Healing reduced by 20%.","nerf"],
        ["Cooldown reduced to 10 seconds (was 15 seconds).","buff"],
        ["Now reduces the cooldown by 10 seconds (was 15 seconds).","nerf"],
        ["Cooldown increased by 10 seconds.","nerf"],
        ["Damage increased by 5% (was 15%).","nerf"],
    ]) {
        const simple = contextForHTML(`<p>Shaman</p><ul><li>${change}</li></ul>`);
        assert.doesNotThrow(() => check(result([[7,expected]]), simple));
        assert.throws(() => check(result([[7,expected === "buff" ? "nerf" : "buff"]]), simple), /expected/);
        assert.throws(() => check(result([[7,"mixed"]]), simple), /expected/);
    }
});

test("non-numeric changes require coverage while mixed effects in one bullet remain model-weighted", () => {
    const context = contextForHTML("<p>Shaman</p><ul><li>Healing</li><li>Cooldown reduced.</li></ul>");
    assert.throws(() => check(result(), context), /Missing target/);
    assert.doesNotThrow(() => check(result([[7,"buff"]]), context));
    const mixed = contextForHTML("<p>Shaman</p><ul><li>Damage increased to 20% (was 10%) and healing reduced by 50%.</li></ul>");
    for (const label of ["buff","nerf"]) assert.doesNotThrow(() => check(result([[7,label]]), mixed));
});

test("AI response rejection retains reasons and safely renderable analysis without repairing it", async () => {
    const context = contextFor(6377649);
    const invalid = structuredClone(september22);
    invalid.changes.specs.push([251,"buff"]);
    await assert.rejects(analyzePNotesContext(context, {fetchImpl: async () => new Response(JSON.stringify({
        message: {content: JSON.stringify(invalid)},
    }))}), error => {
        assert.ok(error instanceof PNotesValidationError);
        assert.match(error.reasons.join("\n"), /Unsupported target/);
        assert.deepEqual(error.analysis, invalid);
        assert.deepEqual(error.rejectedAnalysis, invalid);
        return true;
    });
    for (const content of ["not json", JSON.stringify(result([[999,"buff"]]))]) {
        await assert.rejects(analyzePNotesContext(context, {fetchImpl: async () => new Response(JSON.stringify({
            message: {content},
        }))}), error => {
            assert.ok(error instanceof PNotesValidationError);
            assert.equal(error.analysis, null);
            assert.ok(error.rejectedAnalysis);
            return true;
        });
    }
});
