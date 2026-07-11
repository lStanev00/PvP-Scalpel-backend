import { spawn } from "node:child_process";

export default async function enqueueAIValidation(path) {
    const chunks = []; // ffmpeg returned chunks;

    const ffmpeg = spawn("ffmpeg", [
        "-i",
        path,

        // 1 frame every 20 sec and resize to 720p
        "-vf",
        "fps=1/20,scale=720:-2",

        // quality of the jpeg (lower is better)
        "-q:v",
        "2",

        // Output JPEG stream to stdout
        "-f",
        "image2pipe",
        "-vcodec",
        "mjpeg",
        "pipe:1",
    ]);

    ffmpeg.stdout.on("data", (chunk) => {
        chunks.push(chunk);
    });

    // logs on err
    ffmpeg.stderr.on("data", (data) => {
        console.log(data.toString());
    });

    ffmpeg.on("error", reject);

    // handle the close to finilize
    ffmpeg.on("close", async (code) => {
        if (code !== 0) {
            reject(new Error(`FFmpeg exited with code ${code}`));
            return;
        }

        const outputBuffer = Buffer.concat(chunks);
        const frames = splitJpegs(outputBuffer);

        return await validateFramesWithOllama(frames);
    });
}

function splitJpegs(buffer) {
    const frames = [];
    let start = -1;

    for (let i = 0; i < buffer.length - 1; i++) {
        const isStart = buffer[i] === 0xff && buffer[i + 1] === 0xd8;
        const isEnd = buffer[i] === 0xff && buffer[i + 1] === 0xd9;

        if (isStart) {
            start = i;
        }

        if (isEnd && start !== -1) {
            frames.push(buffer.subarray(start, i + 2));
            start = -1;
        }
    }

    return frames;
}

const MODERATION_PROMPT = `
You are moderating uploaded video frames for PvP Scalpel, a World of Warcraft PvP website.

Decide if these frames are allowed.

Allowed content:
- World of Warcraft gameplay
- WoW PvP arenas
- WoW battlegrounds
- WoW UI, scoreboard, damage meters, addons
- Gaming-related menus or loading screens

Reject content:
- pornography or explicit sexual content
- nudity or sexualized real people
- graphic real-world violence
- non-gaming real-life footage
- unrelated movies, TV, anime, memes, ads, or random videos
- visible watermarks from stolen/reposted content when it looks like copied media
- content that is clearly not related to World of Warcraft or PvP Scalpel

Return ONLY valid JSON with this shape:

{
    "decision": "allow" | "reject" | "manual_review",
    "pornography": true | false,
    "wow_pvp_relevant": true | false,
    "confidence": 0.0,
    "reasons": ["short reason"],
    "frame_notes": [
        {
            "frame": 1,
            "safe": true,
            "reason": "short note"
        }
    ]
}

Rules:
- If pornography is visible, decision must be "reject".
- If frames are unclear or confidence is below 0.75, use "manual_review".
- If the video appears to be World of Warcraft but not clearly PvP, use "manual_review".
- Do not explain outside the JSON.
`;

async function validateFramesWithOllama(frames) {
    if (!Array.isArray(frames) || frames.length === 0) {
        throw new TypeError("Ollama moderation requires at least one JPEG frame");
    }

    if (!frames.every((frame) => Buffer.isBuffer(frame))) {
        throw new TypeError("Ollama moderation frames must be Buffer instances");
    }

    const baseUrl = (process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/+$/, "");
    let response;

    try {
        response = await fetch(`${baseUrl}/api/chat`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "gemma4:e4b",
                messages: [
                    {
                        role: "system",
                        content: MODERATION_PROMPT,
                    },
                    {
                        role: "user",
                        content: "Moderate these video frames in their provided chronological order",
                        images: frames.map((frame) => frame.toString("base64")),
                    }
                ],
                format: "json",
                stream: false,
            }),
        });
    } catch (error) {
        throw new Error(`Ollama moderation request failed: ${error.message}`, {
            cause: error,
        });
    }

    if (!response.ok) {
        let details = "";

        try {
            details = (await response.text()).trim();
        } catch {}

        const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
        throw new Error(
            `Ollama moderation request returned HTTP ${status}${details ? `: ${details}` : ""}`,
        );
    }

    let responseBody;

    try {
        responseBody = await response.json();
    } catch (error) {
        throw new Error("Ollama moderation response was not valid JSON", {
            cause: error,
        });
    }

    const moderationJSON = responseBody?.message?.content;
    if (typeof moderationJSON !== "string") {
        throw new Error("Ollama moderation response is missing message.content");
    }

    try {
        return JSON.parse(moderationJSON);
    } catch (error) {
        throw new Error("Ollama moderation result was not valid JSON", {
            cause: error,
        });
    }
}
