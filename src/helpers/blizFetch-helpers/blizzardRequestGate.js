import { setTimeout as delay } from "node:timers/promises";
import { redisCache } from "../redis/connectRedis.js";

// One shared gate for every process using this application's Redis DB 0.
// Default: at most eight request starts per second, including retries.
const configuredInterval = Number(process.env.BLIZZARD_REQUEST_INTERVAL_MS);
const intervalMs = Number.isFinite(configuredInterval) && configuredInterval >= 1
    ? Math.ceil(configuredInterval) : 125;
const key = "blizzard:request_gate";
const gateScript = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local cooldown = tonumber(redis.call('HGET', KEYS[1], 'cooldownUntil')) or 0
if ARGV[1] == 'cooldown' then
    cooldown = math.max(cooldown, now + tonumber(ARGV[2]))
    redis.call('HSET', KEYS[1], 'cooldownUntil', cooldown)
    redis.call('PEXPIRE', KEYS[1], math.ceil(cooldown - now + 60000))
    return math.ceil(cooldown - now)
end
local nextRequest = tonumber(redis.call('HGET', KEYS[1], 'nextRequestAt')) or 0
local wait = math.max(cooldown, nextRequest) - now
if wait > 0 then return math.ceil(wait) end
redis.call('HSET', KEYS[1], 'nextRequestAt', now + tonumber(ARGV[2]))
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]) + 60000)
return 0
`;

async function runGate(action, durationMs, signal) {
    signal?.throwIfAborted();
    // Never send unpaced requests while Redis is disconnected.
    if (!redisCache.isReady) throw new Error("Blizzard request gate: Redis is unavailable");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("Blizzard request gate timed out")), 5000);
    timer.unref?.();
    const commandSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    try {
        return await new Promise((resolve, reject) => {
            const aborted = () => reject(commandSignal.reason);
            commandSignal.addEventListener("abort", aborted, { once: true });
            // Race the reply as well: node-redis only cancels commands before sending.
            Promise.resolve().then(() => redisCache.withAbortSignal(commandSignal).eval(gateScript, {
                keys: [key], arguments: [action, String(durationMs)],
            })).then(resolve, reject).finally(() => commandSignal.removeEventListener("abort", aborted));
        });
    } finally {
        clearTimeout(timer);
    }
}

/** Wait for a globally paced request slot; caller cancellation stops the wait. */
export async function waitForBlizzardSlot(signal) {
    while (true) {
        signal?.throwIfAborted();
        const waitMs = Number(await runGate("acquire", intervalMs, signal));
        if (waitMs <= 0) return;
        // Recheck after waking: another process may have extended the cooldown.
        await delay(Math.min(waitMs, 60_000), undefined, { signal });
    }
}

/** Publish a shared 429 cooldown without shortening another process's cooldown. */
export async function backOffBlizzard(retryAfter, attempt, signal) {
    const value = typeof retryAfter === "string" ? retryAfter.trim() : "";
    let waitMs;
    if (/^\d+$/.test(value)) waitMs = Number(value) * 1000;
    else if (value) waitMs = Date.parse(value) - Date.now();
    if (!Number.isFinite(waitMs) || waitMs < 0) {
        waitMs = Math.min(60_000, 5000 * 2 ** (attempt - 1));
    }
    return Number(await runGate("cooldown", Math.max(1000, Math.ceil(waitMs)), signal));
}
