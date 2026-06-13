import "dotenv/config";

export const CDNURI = "http://" + process.env.CDN_PRIVATE_DOMAIN + ":" + process.env.CDN_PORT;

// export const CDNAUTH = process.env.JWT_CDN_PUBLIC;
export const CDNAUTH =
    "2x5ZLnz88q3YdSL0N8yWxEZ_T53xQ6_VzXpdEX-i2x5ZLnz88q3PVP_PUBLICC468JFD4H6SG85ADFS65489HG7F6453B1";

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
