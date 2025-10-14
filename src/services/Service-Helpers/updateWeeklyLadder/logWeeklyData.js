import { createClient } from "redis";
import fs from "node:fs/promises";

function arg(key, def) {
    const p = process.argv.find(a => a.startsWith(`--${key}=`));
    return p ? p.split("=")[1] : def;
}

const REDIS_URL = arg("redis", "redis://127.0.0.1:6379");
const HASH = arg("hash", "weeklyChampsCache");
const TOP = Number(arg("top", "10"));
const FORMAT = arg("format", "table");

function parseJSON(v) {
    try { return JSON.parse(v); } catch { return []; }
}

function normalizeEntry(e, fallbackBracket) {
    let playerSearch = e.playerSearch ?? "";
    let bracketName = null;
    let startRating = null;
    let result = null;
    if (Array.isArray(e.bracketName)) {
        bracketName = e.bracketName[0] ?? fallbackBracket ?? null;
        startRating = e.bracketName[1] ?? null;
        result = e.bracketName[2] ?? null;
    } else {
        bracketName = e.bracketName ?? fallbackBracket ?? null;
        if (typeof e.startRating === "number") startRating = e.startRating;
        if (typeof e.result === "number") result = e.result;
    }
    return { playerSearch, bracketName, startRating, result };
}

function normalizeArray(arr, fallbackBracket) {
    return arr.map(x => normalizeEntry(x, fallbackBracket)).filter(x => x.playerSearch);
}

function rankize(arr, top) {
    const scored = arr.filter(x => typeof x.result === "number");
    scored.sort((a, b) => (b.result ?? -Infinity) - (a.result ?? -Infinity));
    return scored.slice(0, top).map((x, i) => ({ rank: i + 1, ...x }));
}

function pad(n, w) {
    const s = String(n ?? "");
    return s.length >= w ? s : s + " ".repeat(w - s.length);
}

function printTable(title, rows) {
    if (!rows.length) {
        console.log(`${title}: no data`);
        return;
    }
    const headers = ["rank", "playerSearch", "bracketName", "startRating", "result"];
    const widths = { rank: 4, playerSearch: 32, bracketName: 28, startRating: 12, result: 8 };
    console.log("\n" + title);
    console.log("-".repeat(90));
    console.log(headers.map(h => pad(h, widths[h])).join(" | "));
    console.log(headers.map(h => "-".repeat(widths[h])).join("-+-"));
    for (const r of rows) {
        console.log([
            pad(r.rank, widths.rank),
            pad(r.playerSearch, widths.playerSearch),
            pad(r.bracketName ?? "", widths.bracketName),
            pad(r.startRating ?? "", widths.startRating),
            pad(typeof r.result === "number" ? (r.result > 0 ? `+${r.result}` : String(r.result)) : "", widths.result)
        ].join(" | "));
    }
}

function toHTMLTable(title, rows) {
    const esc = s => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    if (!rows.length) return `<section><h2>${esc(title)}</h2><p>No data</p></section>`;
    const tr = rows.map(r => `<tr><td>${r.rank}</td><td>${esc(r.playerSearch)}</td><td>${esc(r.bracketName)}</td><td>${esc(r.startRating ?? "")}</td><td>${typeof r.result==="number"?(r.result>0?`+${r.result}`:r.result):""}</td></tr>`).join("");
    return `<section><h2>${esc(title)}</h2><table><thead><tr><th>#</th><th>Player</th><th>Bracket</th><th>Start</th><th>Δ</th></tr></thead><tbody>${tr}</tbody></table></section>`;
}

function wrapHTML(body) {
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>Weekly Champs Leaderboard</title>
<style>
body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial;margin:24px;color:#111}
h1{margin:0 0 12px 0}
h2{margin:28px 0 8px 0}
table{border-collapse:collapse;width:100%;margin:8px 0 24px 0}
th,td{border:1px solid #ddd;padding:8px 10px;text-align:left;font-size:14px}
thead th{background:#f3f4f6}
tbody tr:nth-child(even){background:#fafafa}
small{color:#555}
</style>
</head>
<body>
<h1>Weekly Champs Leaderboard</h1>
${body}
<footer><small>Generated ${new Date().toISOString()}</small></footer>
</body>
</html>`;
}

async function main() {
    const client = createClient({ url: REDIS_URL });
    await client.connect();
    const raw = await client.hGetAll(HASH);
    const brackets = Object.keys(raw);
    const buckets = {};
    for (const b of brackets) {
        const arr = parseJSON(raw[b]);
        const normalized = normalizeArray(arr, b);
        buckets[b] = rankize(normalized, TOP);
    }
    if (FORMAT === "json") {
        console.log(JSON.stringify(buckets, null, 2));
    } else if (FORMAT === "html") {
        const sections = Object.entries(buckets).map(([k,v]) => toHTMLTable(k, v)).join("");
        const html = wrapHTML(sections);
        const out = "weekly-leaderboard.html";
        await fs.writeFile(out, html, "utf8");
        console.log(`written ${out}`);
    } else {
        for (const [k, v] of Object.entries(buckets)) printTable(k, v);
    }
    await client.disconnect();
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
