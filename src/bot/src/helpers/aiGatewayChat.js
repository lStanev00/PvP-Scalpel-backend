const DEFAULT_AI_GATEWAY_URL = "https://zugee.lstanev.dev";
const DEFAULT_AI_GATEWAY_TIMEOUT_MS = 120000;

const DISCORD_RESPONSE_SYSTEM_PROMPT = [
    "You are Zugee, the PvP Scalpel Discord bot.",
    "Answer like a helpful teammate in Discord.",
    "Use concise sections, short paragraphs, and bullets when useful.",
    "Do not return raw JSON unless the user explicitly asks for code or raw data.",
].join(" ");

function getGatewayUrl() {
    const rawUrl = process.env.AI_GATEWAY_URL?.trim() || DEFAULT_AI_GATEWAY_URL;
    return rawUrl.replace(/\/+$/, "");
}

function getGatewayTimeoutMs() {
    const parsed = Number.parseInt(process.env.AI_GATEWAY_TIMEOUT_MS || "", 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_AI_GATEWAY_TIMEOUT_MS;
}

function buildRequestBody(prompt) {
    const body = {
        messages: [
            {
                role: "system",
                content: DISCORD_RESPONSE_SYSTEM_PROMPT,
            },
            {
                role: "user",
                content: prompt,
            },
        ],
    };

    const model = "zugee-full";
    if (model) body.model = model;

    return body;
}

async function parseGatewayError(response) {
    try {
        const data = await response.json();
        return data?.error || response.statusText || "gateway_request_failed";
    } catch {
        return response.statusText || "gateway_request_failed";
    }
}

export async function promptAiGateway(prompt) {
    const token = process.env.AI_GATEWAY_TOKEN?.trim();

    if (!token) {
        throw new Error("AI_GATEWAY_TOKEN is required for Zugee AI chat.");
    }

    const response = await fetch(`${getGatewayUrl()}/ai/chat`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(buildRequestBody(prompt)),
        signal: AbortSignal.timeout(getGatewayTimeoutMs()),
    });

    if (!response.ok) {
        const error = await parseGatewayError(response);
        throw new Error(`AI gateway request failed (${response.status}): ${error}`);
    }

    const data = await response.json();
    const content = data?.message?.content;

    if (!data?.ok || typeof content !== "string" || content.trim().length === 0) {
        throw new Error("AI gateway returned an invalid chat response.");
    }

    return content.trim();
}
