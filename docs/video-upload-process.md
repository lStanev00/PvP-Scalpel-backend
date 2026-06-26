# Video Upload Process

This document describes the current video upload process in the PvP Scalpel backend. It is written for full-stack developers who need to understand how the REST API, WebSocket service, CDN presigned URLs, MongoDB metadata, and Redis upload cache work together.

The frontend implementation is not present in this repository, so client behavior is described from the backend contracts exposed by this service.

## Architecture Overview

The upload flow is backend-coordinated but client-to-CDN for the heavy file transfer:

- The REST API creates the media record and asks the CDN service for presigned upload URLs.
- The client uploads video parts directly to the CDN with `PUT` requests against those presigned URLs.
- The WebSocket service receives upload progress/metadata messages and updates the `MediaMeta` document.
- MongoDB stores the durable media metadata and upload manifest.
- Redis stores a temporary media upload cache entry while the upload is in progress.
- The CDN service owns object storage signing and returns upload URLs for specific object keys.

Important source files:

- `src/controllers/route_logic/mediaCTRL/createMediaPOST.js`
- `src/WS/wsHandlers/uploadHandler.js`
- `src/Models/MediaMeta.js`
- `src/caching/mediaCache/mediaCache.js`
- `src/caching/CDNCache/CDN/cdn.config.js`

## End-to-End Sequence

1. An authenticated admin calls `POST /media` with `fileData` and, optionally, an initial `manifest`.
2. The REST handler creates a `MediaMeta` document with `state: "initializing"`.
3. The new media document is cached in Redis under the `media:data` hash for two hours.
4. For each item in `fileData`, the backend asks the CDN service for a presigned upload URL.
5. The REST response returns the created `mediaObj` and the list of upload `urls`.
6. The client uploads video parts directly to the CDN using the returned presigned URLs.
7. After each successful part upload, the client sends a WebSocket `uploadMedia` message with inner `type: "uploadFeedback"`.
8. The WebSocket handler records each uploaded part route in `mediaDoc.manifest.mediaParts[index]` and moves the media state to `uploading`.
9. The client updates title, description, bracket, characters, and privacy through the WebSocket `metaUpdate` message. The current REST initialization handler does not read those editable metadata fields from the request body.
10. The client requests a thumbnail upload URL with `getThumbnailImageUpload`, uploads the thumbnail directly to the CDN, then records the thumbnail path with `thumbnailUpdate`.
11. The client sends `finalize` with the expected `partsCount`.
12. The WebSocket handler validates required metadata, uploaded parts, and thumbnail. If valid, it sets `state: "done"` and clears the Redis upload cache entry.

## REST Initialization: `POST /media`

Route registration:

```js
mediaCTRL.post("/media", requireAdmin, createMediaPOST);
```

The route is protected by `requireAdmin`. A request must already have `req.user` populated by the REST auth middleware, and `req.user.role` must be `"admin"`.

Expected body shape:

```json
{
  "manifest": {
    "mediaParts": [],
    "thumbnail": null
  },
  "fileData": [
    { "name": "part-0.mp4" },
    { "name": "part-1.mp4" }
  ]
}
```

`fileData` is required and must be a non-empty array. The backend does not currently inspect each file item for size, MIME type, checksum, or filename. It only uses the array length to create one presigned upload URL per item.

The current handler only destructures `fileData` and `manifest` from the request body. It always creates a video media document and ignores request-body values such as `type`, `isPrivate`, `title`, `description`, `characters`, and `bracket`. Those fields keep their schema defaults until changed through `metaUpdate`.

On success, the handler creates:

```js
{
  type: "video",
  state: "initializing",
  author: req.user._id,
  manifest
}
```

Then it returns:

```json
{
  "mediaObj": {
    "_id": "<mediaId>",
    "type": "video",
    "state": "initializing"
  },
  "urls": [
    "https://presigned-upload-url-for-part-0",
    "https://presigned-upload-url-for-part-1"
  ]
}
```

## CDN Presigned Upload URLs

Upload signing is handled by `uploadPresignLink()` in `src/caching/CDNCache/CDN/cdn.config.js`.

The backend sends a `POST` request to:

```text
http://<CDN_PRIVATE_DOMAIN>:<CDN_PORT>/presign/upload
```

The request includes:

```json
{
  "bucket": "pvp-scalpel-frontend",
  "keyId": "videos/<mediaId>/part_<index>"
}
```

The expected CDN success response includes:

```json
{
  "uploadUrl": "https://...",
  "expiresIn": 3600
}
```

The client is expected to use the returned `uploadUrl` to upload the bytes directly to object storage with `PUT`. The backend does not proxy video bytes.

Thumbnail upload uses the same presign helper, but the key is:

```text
videos/<mediaId>/thumbnail
```

## WebSocket Upload Protocol

All upload-related WebSocket messages use the outer message type `uploadMedia`:

```json
{
  "type": "uploadMedia",
  "data": {
    "type": "<upload action>",
    "msgContext": {
      "mediaID": "<mediaId>"
    }
  }
}
```

The WebSocket connection must be authenticated for upload actions. The WebSocket auth layer reads the `token` cookie from the upgrade request, validates the JWT, loads the user, and checks the fingerprint. The upload handler then requires `ws.user`.

For each upload action, the handler also verifies:

- `msg.data` exists and is an object.
- `msg.data.msgContext` exists and is an object.
- `msgContext.mediaID` is provided.
- The media exists in the Redis upload cache.
- The media document exists in MongoDB.
- The socket user is either the media owner or an admin.

### `uploadFeedback`

Use this after a video part has been uploaded to the CDN.

Request:

```json
{
  "type": "uploadMedia",
  "data": {
    "type": "uploadFeedback",
    "msgContext": {
      "mediaID": "<mediaId>",
      "index": 0,
      "route": "videos/<mediaId>/part_0"
    }
  }
}
```

Backend behavior:

- Ensures `mediaDoc.manifest` exists.
- Ensures `mediaDoc.manifest.mediaParts` is an array.
- Writes `route` at `mediaDoc.manifest.mediaParts[index]`.
- Sets `mediaDoc.state = "uploading"`.
- Saves the document.
- Refreshes the Redis cache entry with the saved document.
- Sends an `uploadFeedback` WebSocket response containing the saved media.

### `metaUpdate`

Use this to update editable media metadata while the upload is in progress.

Request:

```json
{
  "type": "uploadMedia",
  "data": {
    "type": "metaUpdate",
    "msgContext": {
      "mediaID": "<mediaId>",
      "doc": {
        "title": "Updated title",
        "description": "Updated description",
        "bracket": 2,
        "characters": ["<characterObjectId>"],
        "isPrivate": true
      }
    }
  }
}
```

Backend behavior:

- Updates `bracket`, `characters`, `description`, and `title` only when the provided value is truthy.
- Updates `isPrivate` only when the provided value is a boolean.
- Saves the document.
- Refreshes the Redis cache entry.
- Sends a `metaUpdate` WebSocket response containing the saved media.

### `getThumbnailImageUpload`

Use this to get a presigned upload URL for the thumbnail image.

Request:

```json
{
  "type": "uploadMedia",
  "data": {
    "type": "getThumbnailImageUpload",
    "msgContext": {
      "mediaID": "<mediaId>"
    }
  }
}
```

Backend behavior:

- Requests a CDN presigned upload URL for `videos/<mediaId>/thumbnail`.
- Sends a `getThumbnailImageUpload` WebSocket response containing the CDN response.

### `thumbnailUpdate`

Use this after the thumbnail has been uploaded to the CDN.

Request:

```json
{
  "type": "uploadMedia",
  "data": {
    "type": "thumbnailUpdate",
    "msgContext": {
      "mediaID": "<mediaId>",
      "path": "videos/<mediaId>/thumbnail"
    }
  }
}
```

Backend behavior:

- Ensures `mediaDoc.manifest` exists.
- Writes `path` to `mediaDoc.manifest.thumbnail`.
- Saves the document.
- Refreshes the Redis cache entry.
- Sends a `thumbnailUpdate` WebSocket response containing the saved media.

### `finalize`

Use this after all video parts and the thumbnail have been uploaded and reported.

Request:

```json
{
  "type": "uploadMedia",
  "data": {
    "type": "finalize",
    "msgContext": {
      "mediaID": "<mediaId>",
      "partsCount": 2
    }
  }
}
```

Backend validation:

- `partsCount` must be a positive integer.
- `title` must be a non-empty string after trimming.
- `description` must be a string. Empty descriptions are currently allowed.
- `bracket` must not be `undefined` or `null`.
- `manifest.mediaParts` must exist and be an array.
- `manifest.mediaParts.length` must equal `partsCount`.
- Every media part must be a non-empty string.
- `manifest.thumbnail` must be a non-empty string.

Backend behavior after validation:

- Sets `mediaDoc.state = "done"`.
- Saves the document.
- Deletes the Redis upload cache entry with `finalizeUploadCache(mediaId)`.
- Sends a `finalize` WebSocket response containing the saved media.

## `MediaMeta` Data Model

`MediaMeta` is the durable MongoDB record for uploaded media.

Important fields:

| Field | Meaning |
| --- | --- |
| `type` | Currently only `"video"` is allowed. |
| `state` | Upload lifecycle state: `"initializing"`, `"uploading"`, or `"done"`. |
| `censored` | Boolean flag, default `false`. |
| `isPrivate` | Boolean privacy flag, default `false`; currently set after initialization through `metaUpdate`. |
| `title` | Required title string, default `""`; must be non-empty before `finalize`. |
| `description` | Optional description string, default `""`. |
| `views` | View counter, default `0`. |
| `author` | User ObjectId reference. |
| `characters` | Array of character ObjectId references; currently set after initialization through `metaUpdate`. |
| `bracket` | Game bracket numeric reference, default `0`; currently set after initialization through `metaUpdate` when a truthy value is provided. |
| `manifest.mediaParts` | Ordered list of CDN object paths for video parts. |
| `manifest.thumbnail` | CDN object path for the thumbnail. |

State transitions:

```text
initializing -> uploading -> done
```

`initializing` is assigned when the media record is created. `uploading` is assigned after at least one `uploadFeedback` message is processed. `done` is assigned only by `finalize` after all required metadata and upload paths are present.

## Redis Upload Cache

The Redis media cache is implemented in `src/caching/mediaCache/mediaCache.js`.

Cache settings:

```js
const hashKey = "media:data";
const ttl = 7200;
```

Lifecycle:

- `initMediaForm(mediaDoc)` validates the Mongoose document and stores `mediaDoc.toObject()` in Redis.
- The cache entry key is the media document `_id`.
- The cache entry TTL is 7200 seconds, or two hours.
- `getMediaCache(mediaID)` is required before the WebSocket handler will process upload actions.
- `finalizeUploadCache(mediaID)` deletes the cache entry after successful finalization.

The cache acts as a temporary upload session guard. If the cache entry expires before the upload is finalized, the WebSocket handler rejects later upload messages with:

```text
There's not such media in the cache
```

## Authentication And Authorization

REST:

- All REST routes pass through `authMiddleware`.
- Requests must include the custom `600: BasicPass` header expected by the middleware.
- Authenticated requests use the signed `token` cookie.
- `POST /media` additionally requires `req.user.role === "admin"`.

WebSocket:

- The socket auth context is hydrated from the `token` cookie during the upgrade request.
- Missing cookies are accepted for public socket features, but upload actions require `ws.user`.
- Invalid tokens, missing users, or fingerprint mismatches are rejected during connection setup.
- Upload actions require the socket user to be the media owner or an admin.

## Failure Cases

Common REST failures:

- Missing `fileData`: `400` with a message explaining the required key.
- Empty or non-array `fileData`: currently calls `jsonMessage(res, 500, "1")`.
- Mongoose validation/cast errors: `400`.
- Non-admin request: `403`.
- Missing authenticated user: `401`.
- Unexpected errors: `500`.

Common WebSocket failures:

- Unauthenticated upload action: sends `auth: "not authenticated"` and closes with code `1008`.
- Missing `data`, `msgContext`, or `mediaID`: sends an `error` message.
- Missing Redis cache entry: sends an `error` message.
- Missing MongoDB media document: sends an `error` message.
- Non-owner and non-admin user: sends `Non authorized action`.
- Invalid `finalize` fields: sends a specific `Finalize requires ...` error.

## Current Implementation Notes

These are current code details that future work should account for:

- The TypeScript declaration uses `meidaParts`, while the Mongoose schema and runtime code use `mediaParts`.
- The `CreateMediaBody` typedef still lists editable metadata fields, but the current `createMediaPOST` runtime only reads `fileData` and `manifest`.
- `createMediaPOST` builds part keys with `fileData.entries()`, so object keys are generated as `videos/<mediaId>/part_<index>` in request array order.
- `createMediaPOST` only pushes CDN responses that contain `uploadUrl`, so a degraded CDN response can make `urls.length` smaller than `fileData.length`.
- `uploadPresignLink()` supports `mimeType`, but the current media upload calls do not pass it.
- The CDN authorization token is hardcoded in `cdn.config.js`, while the README lists `JWT_CDN_PUBLIC` as an environment variable. This should be reviewed before production hardening.
- The backend records the object paths reported by the client; it does not currently verify that the CDN objects actually exist before finalization.
- There is no current backend merge/transcode step in this repository. The uploaded video parts are tracked as ordered manifest entries.
- `metaUpdate` only updates several fields when values are truthy, so empty strings cannot clear `title` or `description` through this action.
- Finalization requires `description` to be a string, but the non-empty description check is commented out.

## Minimal Client Responsibility

From the backend contract, a compatible client should:

1. Authenticate as an admin for the initial `POST /media` call.
2. Split or prepare the video into the same number of items sent in `fileData`.
3. Upload each video part to its corresponding presigned URL.
4. Send `uploadFeedback` for each uploaded part with the correct part index and CDN route.
5. Keep a WebSocket connection authenticated with the same user or an admin user.
6. Upload a thumbnail through the thumbnail presign flow.
7. Send required editable metadata, especially a non-empty `title`, through `metaUpdate` before finalization.
8. Call `finalize` before the two-hour Redis upload cache expires.
