import { redisCache } from "../helpers/redis/connectRedis.js";
import getCache from "../helpers/redis/getterRedis.js";
import setCache from "../helpers/redis/setterRedis.js";
import threadBoot from "../helpers/threadBoot.js";
import publishPNotes from "./Service-Helpers/CFPNotes/publishPNotes.js";
import { getLatestPNotes } from "./Service-Helpers/CFPNotes/getLatesPNotes.js";
import getPostContent from "./Service-Helpers/CFPNotes/getPostContent.js";
import { jev } from "../helpers/jev/jevConnect.js";
import { choice, noul } from "@typesafe-ai/sdk";

await threadBoot(true);

const HASH_NAME = "CFPNotes";

const latestPNotes = await getLatestPNotes();
if (!latestPNotes?.id) process.exit(1);

// const latestCache = await getCache(HASH_NAME);
// if (latestCache === latestPNotes.id) process.exit(0);

const postContent = await getPostContent(latestPNotes);

async function analyzePatch(className, spec, notes) {
    const req = await jev({
        state: {
            class: className,
            spec,
            rule: "General class changes affect PvP unless explicitly excluded.",
            notes,
        },

        questions: {
            patchOutcome: choice(
                "Classify the overall PvP impact. General changes affect PvP unless explicitly excluded.",
                {
                    buff: "At least one PvP-relevant buff remains, and the remaining PvP changes are overall positive.",
                    nerf: "At least one PvP-relevant nerf remains, and the remaining PvP changes are overall negative.",
                    noPvP: "EVERY listed gameplay change is explicitly excluded from PvP. Do not choose this if even one change can affect PvP.",
                },
            ),

            hasBugfix: choice(
                "Classify an explicit bugfix only. Do not treat normal tuning, 'increased', 'reduced', or 'no longer' changes as bugfixes unless the text says an issue/bug/error was fixed or corrected.",
                {
                    positive: "Explicit bugfix makes the spec stronger.",
                    negative: "Explicit bugfix makes the spec weaker.",
                    neutral: "Explicit bugfix with no clear power change.",
                    no: "No explicit bugfix is stated.",
                },
            ),
        },
    });

    return req.answers;
}

async function analyzeAllPatches(ctxMap) {
    const patches = [...ctxMap.entries()].map(([key, notes], index) => {
        const [className, ...specParts] = key.split(":");
        const spec = specParts.join(":");

        return {
            id: index,
            class: className,
            spec,
            notes,
        };
    });

    const questions = {};

    for (const patch of patches) {
        questions[`patch_${patch.id}_outcome`] = choice(
            `Classify the overall PvP impact for patches[${patch.id}].
            General changes affect PvP unless explicitly excluded.`,
            {
                buff: "At least one PvP-relevant buff remains, and the remaining PvP changes are overall positive.",
                nerf: "At least one PvP-relevant nerf remains, and the remaining PvP changes are overall negative.",
                noPvP: "EVERY listed gameplay change is explicitly excluded from PvP. Do not choose this if even one change can affect PvP.",
            },
        );

        questions[`patch_${patch.id}_bugfix`] = choice(
            `Classify explicit bugfixes for patches[${patch.id}].
            Do not treat normal tuning as a bugfix unless the text says an issue, bug, error, or incorrect behavior was fixed/corrected.`,
            {
                positive: "Explicit bugfix makes the spec stronger.",
                negative: "Explicit bugfix makes the spec weaker.",
                neutral: "Explicit bugfix with no clear combat-power change.",
                no: "No explicit bugfix is stated.",
            },
        );
    }

    const req = await jev({
        state: {
            rule: "General class changes affect PvP unless explicitly excluded.",
            patches,
        },

        questions,
    });

    console.info(req.usage);
    debugger
    const results = new Map();

    for (const patch of patches) {
        const key = `${patch.class}:${patch.spec}`;

        results.set(key, {
            class: patch.class,
            spec: patch.spec,
            notes: patch.notes,

            patchOutcome:
                req.answers[`patch_${patch.id}_outcome`],

            hasBugfix:
                req.answers[`patch_${patch.id}_bugfix`],
        });
    }

    return results;
}
const pnotesArr = postContent.content.split("\n");
const classes = pnotesArr.reduce((acc, entry, index) => {
    if (index === 0 || !entry.trim) return acc;
    if (/^[A-Za-z]/.test(entry)) acc.push([entry, index]);
    return acc;
}, []);

const mappedToClassNotes = [];

for (let i = 0; i < classes.length; i++) {
    const current = classes[i];
    const next = classes[i + 1];
    let ctx;
    if (!next) {
        ctx = pnotesArr.slice(current[1]);
    } else {
        ctx = pnotesArr.slice(current[1], next[1]);
    }

    mappedToClassNotes.push(ctx);
}

const ctxMap = new Map();

for (const entry of mappedToClassNotes) {
    if (entry.length <= 2) continue;
    const clone = [...entry];
    const modClass = entry[0];
    console.info(modClass);

    const affectedSpecsMaped = clone.reduce((acc, entry, index) => {
        if (index === 0 || !entry.trim || entry.includes("Developers’ notes:")) return acc;
        if (entry.startsWith("• ")) {
            acc.push([entry.replace("• ", ""), index]);
        }
        return acc;
    }, []);

    console.info(affectedSpecsMaped.join("\n"));
    for (let i = 0; i < affectedSpecsMaped.length; i++) {
        const current = affectedSpecsMaped[i][1];
        const next = affectedSpecsMaped[i + 1]?.[1];
        let ctx;
        if (!next) {
            ctx = entry.slice(current + 1);
        } else {
            ctx = entry.slice(current + 1, next);
        }
        // console.info(ctx)
        ctx = ctx.reduce((acc, entry) => {
            if(entry.includes("Does not affect PvP combat") || entry.includes("Does not apply to PvP combat.") || entry.includes("Developers’ notes:") || !(entry.trim())) return acc;
            const edit = entry.replace("•", "").trim();
            acc.push(edit);
            return acc
        }, [])
        if (ctx.length === 0) continue;
        const target = [modClass, affectedSpecsMaped[i][0]].join(":");
        const cunretClassCTX = ctxMap.get(target);
        ctxMap.set(target , cunretClassCTX ? [...cunretClassCTX, ...ctx] : ctx)
        // const outcome = await analyzePatch(modClass, affectedSpecsMaped[i][0], ctx);
        // console.info(outcome);
    }
    // debugger;
    // console.clear();
}

const analyzed = await analyzeAllPatches(ctxMap);
const arr = [...analyzed].map(([key, value]) => ({
    key,
    value,
}));
for (const element of arr) {
    const entry = element.value;
    console.info(`${element.key} : patchOutcome = ${entry.patchOutcome.choice} | hasBugfix: ${entry.hasBugfix.choice}`)
}
// console.log(
//     JSON.stringify(
//         Object.fromEntries(analyzed),
//         null,
//         4,
//     ),
// );
debugger;
// const req = await jev({
//     state: {
//         class: "DEATH KNIGHT",
//         spec: "Blood",
//         rule: "General class changes affect PvP unless explicitly excluded.",
//         notes: mappedToClassNotes[0].slice(2, 13),
//     },
//     questions: {
//         patchOutcome: choice("Is this more buff or nerf or simply none of the patch affect PvP", {
//             buff: null,
//             nerf: null,
//             noPvP: null
//         })
//     },
// });

// console.info(req.answers);

console.info(mappedToClassNotes);
console.info(classes);
console.info(pnotesArr);
debugger;
await publishPNotes(postContent, {
    publish: (channel, message) => redisCache.publish(channel, message),
    cache: setCache,
});

// console.info(JSON.stringify({ analysis, card }, null, 4));
// console.info(JSON.stringify(analysis, null, 4));
process.exit(0);
