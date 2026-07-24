import "dotenv/config";

export const CDNURI = "http://" + process.env.CDN_PRIVATE_DOMAIN + ":" + process.env.CDN_PORT;

export const CDNAUTH =
    process.env.JWT_CDN_PUBLIC ||
    "2x5ZLnz88q3YdSL0N8yWxEZ_T53xQ6_VzXpdEX-i2x5ZLnz88q3PVP_PUBLICC468JFD4H6SG85ADFS65489HG7F6453B1";
const CDN_DELETE_TIMEOUT_MS = 60 * 1000;

export async function retriveCDNLink(keyId) {
    const response = await fetch(`${CDNURI}/presign/download`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${CDNAUTH}`,
        },
        body: JSON.stringify({
            keyId,
        }),
    });

    return await response.json();
}

/**
 * @typedef {Object} UploadPresignParams
 * @property {string} keyId Object key/path in the target bucket.
 * @property {string} [bucket] Storage bucket. The CDN default is used when omitted.
 * @property {string} [mimeType] MIME type that the subsequent upload must use.
 */

/**
 * @typedef {Object} UploadPresignSuccess
 * @property {string} uploadUrl Presigned URL for the object upload.
 * @property {number} expiresIn Number of seconds until the URL expires.
 */

/**
 * @typedef {Object} UploadPresignError
 * @property {string} error Error message returned by the CDN service.
 */

/**
 * Creates a presigned CDN URL for uploading an object with `PUT`.
 *
 * @param {UploadPresignParams} [params]
 * @returns {Promise<UploadPresignSuccess | UploadPresignError | null>}
 * `null` when `keyId` is missing; otherwise the CDN response payload.
 */
export async function uploadPresignLink(params = {}) {
    const { keyId, bucket, mimeType } = params;

    if (!keyId) return null;

    const body = { keyId };
    if (bucket !== undefined) body.bucket = bucket;
    if (mimeType !== undefined) body.mimeType = mimeType;

    const response = await fetch(`${CDNURI}/presign/upload`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${CDNAUTH}`,
        },
        body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
        console.error("Failed to create CDN upload URL", {
            status: response.status,
            keyId,
            bucket,
            error: data?.error,
        });
    }

    return data;
}

/**
 * @typedef {Object} DeleteCDNObjectsParams
 * @property {string} bucket Storage bucket containing the objects.
 * @property {string[]} keyIds Exact object keys to delete.
 */

/**
 * @typedef {Object} DeleteCDNObjectsResult
 * @property {boolean} succeed Whether every requested object was deleted.
 * @property {string[]} deletedKeys Successfully deleted object keys.
 * @property {string[]} failedKeys Object keys the storage provider could not delete.
 */

/**
 * Deletes exact objects through the authenticated storage REST service.
 *
 * @param {DeleteCDNObjectsParams} params
 * @returns {Promise<DeleteCDNObjectsResult>} Per-key deletion result.
 * @throws {TypeError} When the request is invalid.
 * @throws {Error} When the storage service rejects or cannot process the request.
 */
export async function deleteCDNObjects(params = {}) {
    const { bucket, keyIds } = params;

    if (typeof bucket !== "string" || bucket.length === 0) {
        throw new TypeError("deleteCDNObjects requires a bucket");
    }
    if (
        !Array.isArray(keyIds) ||
        keyIds.length === 0 ||
        keyIds.length > 1000 ||
        !keyIds.every((keyId) => typeof keyId === "string" && keyId.length > 0) ||
        new Set(keyIds).size !== keyIds.length
    ) {
        throw new TypeError("deleteCDNObjects requires between 1 and 1000 object keys");
    }

    const response = await fetch(`${CDNURI}/objects`, {
        method: "DELETE",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${CDNAUTH}`,
        },
        body: JSON.stringify({
            bucket,
            keyIds,
        }),
        signal: AbortSignal.timeout(CDN_DELETE_TIMEOUT_MS),
    });

    let data;
    try {
        data = await response.json();
    } catch (error) {
        throw new Error(`Storage deletion returned invalid JSON with HTTP ${response.status}`, {
            cause: error,
        });
    }

    if (!response.ok) {
        throw new Error(
            `Storage deletion failed with HTTP ${response.status}: ${data?.error || "unknown error"}`,
        );
    }
    if (
        typeof data?.succeed !== "boolean" ||
        !Array.isArray(data.deletedKeys) ||
        !Array.isArray(data.failedKeys)
    ) {
        throw new Error("Storage deletion returned an invalid result");
    }

    const requestedKeys = new Set(keyIds);
    const reportedKeys = [...data.deletedKeys, ...data.failedKeys];
    if (
        reportedKeys.length !== requestedKeys.size ||
        new Set(reportedKeys).size !== requestedKeys.size ||
        !reportedKeys.every((keyId) => requestedKeys.has(keyId)) ||
        data.succeed !== (data.failedKeys.length === 0)
    ) {
        throw new Error("Storage deletion result does not match the requested object keys");
    }

    return data;
}
