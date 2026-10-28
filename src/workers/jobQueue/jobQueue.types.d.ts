import type { CharacterRecord } from "../../caching/characters/charCache.types.js";

/** Character payload shared by Redis queue entries and child-process jobs. */
export interface RetrieveCharacterJobData {
    /** Canonical `name:realm:server` key, normalized when queued and dispatched. */
    search: string;
    /** Increment checkedCount; takes precedence over incChechks. Defaults to true. */
    incChecks?: boolean;
    /** Legacy spelling used only when incChecks is undefined. */
    incChechks?: boolean;
    /** Bypass the character cache. Defaults to false. */
    renewCache?: boolean;
    /** Fetch core data without caching it; leave it due for a full refresh. Defaults to false. */
    minimal?: boolean;
}

/** Compatibility name for character payloads stored in the global Redis queue. */
export type CharacterQueueJobData = RetrieveCharacterJobData;

export interface ProcessMediaJobData {
    /** MongoDB ObjectId string, trimmed and lowercased by queue validation. */
    _id: string;
}

export interface RetrieveCharacterQueueJob {
    type: "retrieveCharacter";
    data: RetrieveCharacterJobData;
}

/** Bulk character data accepted by the global queue and directly by a queue worker. */
export interface BulkRetrieveCharacterQueueJob {
    type: "bulkRetrieveCharacter";
    data: RetrieveCharacterJobData[];
}

export interface ProcessMediaQueueJob {
    type: "processMedia";
    data: ProcessMediaJobData;
}

/** Entries stored in the global Redis JobQueue list. */
export type QueueJob =
    | RetrieveCharacterQueueJob
    | BulkRetrieveCharacterQueueJob
    | ProcessMediaQueueJob;

/** IPC requests and per-worker Redis job lists support all three job types. */
export type QueueWorkerJob =
    | RetrieveCharacterQueueJob
    | BulkRetrieveCharacterQueueJob
    | ProcessMediaQueueJob;

/** Character lookup input before normalization into a required search key. */
export type CharacterRetrievalParams = Partial<RetrieveCharacterJobData> & {
    server?: string;
    realm?: string;
    name?: string;
};

export interface CharacterRetrievalOptions {
    /** Wait timeout in milliseconds; defaults to 60000. A nonfinite value disables it. */
    timeoutMs?: number;
    /** Caller cancellation rejects; an elapsed timeout returns null. */
    signal?: AbortSignal;
    /** Enqueue before waiting; defaults to true. */
    enqueue?: boolean;
}

/** prepareCharData result published directly on Redis job:retrieveCharacter. */
export interface RetrieveCharacterResult {
    /** May be absent for invalid input. */
    search?: string;
    /** Missing-character sentinels are preserved; JSON omits undefined values. */
    character?: CharacterRecord | 404 | null;
    status: 200 | 400 | 404 | 500;
}

/** IPC completion metadata; the character itself is delivered through Redis. */
export interface RetrieveCharacterWorkerMessage {
    type: "retrieveCharacter";
    data: {
        search?: string;
        succeed: boolean;
        status: RetrieveCharacterResult["status"];
        job: RetrieveCharacterQueueJob;
        /** Optional diagnostic read by the parent failure handler. */
        stack?: string;
    };
}

export type ProcessMediaOutcome =
    | "processed"
    | "quarantined"
    | "censored"
    | "invalid_job"
    | "not_found"
    | "invalid_state"
    | "failed";

/** Media processing result before the worker attaches the original job. */
export interface ProcessMediaResult {
    /** Normalized media ID, or null when the job has no usable ID. */
    _id: string | null;
    /** Whether the job reached an expected terminal outcome. */
    succeed: boolean;
    /** Worker completion status. */
    status: 200 | 400 | 404 | 409 | 500;
    /** Machine-readable processing outcome. */
    outcome: ProcessMediaOutcome;
    /** Machine-readable reason for an expected safety outcome. */
    reason?: string;
    /** Failure description; omitted for successful outcomes. */
    message?: string;
    /** Original error stack for unexpected processing failures. */
    stack?: string;
}

export interface ProcessMediaWorkerMessage {
    type: "processMedia";
    data: ProcessMediaResult & { job: ProcessMediaQueueJob };
}

/** Discriminated IPC completions sent from jobWorker to its QueueWorker parent. */
export type QueueWorkerMessage = RetrieveCharacterWorkerMessage | ProcessMediaWorkerMessage;
