import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { writeHeapSnapshot } from "node:v8";

function parseBool(value, fallback = false) {
    if (typeof value !== "string") return fallback;
    const normalized = value.trim().toLowerCase();
    if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
        return true;
    }
    if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
        return false;
    }
    return fallback;
}

function parsePositiveInt(value, fallback) {
    const parsed = Number.parseInt(value ?? "", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function formatMemoryUsage() {
    const usage = process.memoryUsage();
    const toMb = (bytes) => Math.round(bytes / 1024 / 1024);

    return {
        rssMB: toMb(usage.rss),
        heapTotalMB: toMb(usage.heapTotal),
        heapUsedMB: toMb(usage.heapUsed),
        externalMB: toMb(usage.external),
        arrayBuffersMB: toMb(usage.arrayBuffers),
    };
}

export function setupHeapDiagnostics(workerName = "worker") {
    const diagnosticsEnabled = parseBool(process.env.WORKER_HEAP_DIAGNOSTICS, true);
    if (!diagnosticsEnabled) return;

    const dumpDir = resolve(process.env.WORKER_HEAP_DUMP_DIR || "./heapdumps");
    const logIntervalMs = parsePositiveInt(process.env.WORKER_MEMORY_LOG_INTERVAL_MS, 0);
    const rssThresholdMb = parsePositiveInt(process.env.WORKER_HEAP_DUMP_RSS_MB, 0);
    const dumpOnStart = parseBool(process.env.WORKER_HEAP_DUMP_ON_START, false);
    const dumpOnFailure = parseBool(process.env.WORKER_HEAP_DUMP_ON_FAILURE, false);

    mkdirSync(dumpDir, { recursive: true });

    let writingSnapshot = false;
    let thresholdTriggered = false;

    const writeSnapshot = (reason) => {
        if (writingSnapshot) return null;

        writingSnapshot = true;
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const filePath = join(dumpDir, `${workerName}-${reason}-${process.pid}-${timestamp}.heapsnapshot`);

        try {
            const writtenPath = writeHeapSnapshot(filePath);
            console.info(`[HeapDump] ${reason} snapshot written to ${writtenPath}`);
            return writtenPath;
        } catch (error) {
            console.error("[HeapDump] Failed to write heap snapshot:", error);
            return null;
        } finally {
            writingSnapshot = false;
        }
    };

    if (process.platform !== "win32") {
        process.on("SIGUSR2", () => {
            writeSnapshot("sigusr2");
        });
    }

    if (dumpOnFailure) {
        process.on("uncaughtExceptionMonitor", () => {
            writeSnapshot("uncaught-exception");
        });
    }

    if (dumpOnStart) {
        writeSnapshot("startup");
    }

    if (logIntervalMs > 0 || rssThresholdMb > 0) {
        setInterval(() => {
            const usage = formatMemoryUsage();

            if (logIntervalMs > 0) {
                console.info(`[Memory] ${JSON.stringify({ worker: workerName, ...usage })}`);
            }

            if (rssThresholdMb > 0) {
                if (usage.rssMB >= rssThresholdMb && !thresholdTriggered) {
                    thresholdTriggered = true;
                    writeSnapshot(`rss-${usage.rssMB}mb`);
                } else if (usage.rssMB < rssThresholdMb) {
                    thresholdTriggered = false;
                }
            }
        }, Math.max(logIntervalMs, 30000)).unref();
    }
}
