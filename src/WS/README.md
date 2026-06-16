# PvP Scalpel WebSocket Service

Realtime WebSocket service for PvP Scalpel character queue checks and lightweight
connection health checks. The service is separate from the REST API and runs from
`src/WS.js`, while the route handlers live in this folder.

## Access

The WebSocket endpoint only accepts upgrade requests on `/`.

- Local default: `ws://localhost:8080/`
- Local with configured port: `ws://localhost:<WSPORT>/`
- Docker Compose default: `ws://localhost:4001/`
- Production: `wss://ws.pvpscalpel.com/`

HTTP behavior is intentionally minimal:

- `GET /robots.txt` returns a crawler denial response.
- Any other plain HTTP request receives a bare `500 Internal Server Error`.
- Any WebSocket upgrade path other than `/` receives a bare `500 Internal Server Error`.
- Rejected origins receive `403 Forbidden`.

## Runtime Requirements

The service boots shared backend dependencies before listening for messages:

- Node.js 22.x
- MongoDB, via `MONGODB_CONNECTION`
- Redis, via either local or container settings
- Blizzard API credentials for character data workers
- Existing queue/cache workers for complete `queueCheck` behavior

Required environment variables used directly or through shared boot helpers:

- `WSPORT` - WebSocket listen port. Defaults to `8080` when not set.
- `MONGODB_CONNECTION` - MongoDB connection string.
- `IS_LOCAL` - `true` to use `REDIS_URL`; otherwise Redis is resolved through the
  Compose service name.
- `REDIS_URL` - local Redis URL when `IS_LOCAL=true`.
- `REDIS_PASSWORD` - Redis password when `IS_LOCAL` is not `true`.
- `REDISPORT` - Redis port when `IS_LOCAL` is not `true`.
- `CLIENT_ID` - Blizzard API client ID.
- `CLIENT_SECRET` - Blizzard API client secret.
- `JWT_SECRET` - JWT signing secret used to validate the optional `token`
  cookie.
- `EXT_DOMAIN` - optional external character provider domain used by shared
  character fetch helpers.

Do not commit real secrets. Keep local values in the root `.env` file or in the
deployment `compose_ship/env/*.env` files.

## Start Commands

Install dependencies from the repository root:

```powershell
npm install
```

Run the WebSocket service once:

```powershell
npm run startWS
```

Run in watch mode during development:

```powershell
npm run devWS
```

The service logs the local and production addresses after the HTTP server starts.

## Docker

The service image is defined by:

- `Dockerfile/websocket.Dockerfile`

The Compose service is defined by:

- `compose_ship/docker-compose.yml`

Compose sets:

```yaml
WSPORT: "4001"
```

and exposes the service on localhost only:

```yaml
ports:
  - "127.0.0.1:4001:4001"
```

The production-style Compose stack depends on Redis health checks before starting
the WebSocket container. The WebSocket process also connects to MongoDB during
startup through shared boot logic.

## Origin Policy

Origin checks are shared with the REST CORS setup in `src/corsSetup.js`.

Allowed origins:

- No `Origin` header
- `https://pvpscalpel.com`
- `https://www.pvpscalpel.com`
- `https://app.pvpscalpel.com`
- `https://guid.pvpscalpel.com`
- `https://api.pvpscalpel.com/`
- `https://pvp-scalpel-frontend-production.up.railway.app`
- `http://localhost:5173`
- `http://localhost:1420`
- `http://tauri.localhost`

Browser clients must connect from one of the configured origins. Non-browser
clients that send no `Origin` header are allowed by the current implementation.

## Authentication Context

The WebSocket service hydrates REST-style user context once during connection
setup. It reads the real browser cookie from the HTTP upgrade request:

```text
Cookie: token=<jwt>
```

If the `token` cookie is missing, the socket stays anonymous and public messages
such as `ping` and `queueCheck` continue to work.

If the `token` cookie exists, the service:

- Validates it with `JWT_SECRET`.
- Loads the user with `User.findById`.
- Verifies the token fingerprint against the stored user fingerprint.
- Attaches the authenticated context to the WebSocket object.

Handlers can then use the same naming pattern as REST middleware:

```js
ws.JWT
ws.user
```

Invalid existing tokens, missing users, or fingerprint mismatches are rejected.
The server sends:

```json
{
  "type": "error",
  "message": "Authentication failed"
}
```

and closes the socket with WebSocket close code `1008`.

If auth context cannot be checked because of an internal error, the server sends
`Authentication unavailable` and closes with code `1011`.

## Message Envelope

All client messages must be valid JSON and include a `type` field:

```json
{
  "type": "ping"
}
```

Invalid JSON receives:

```json
{
  "type": "error",
  "message": "invalid json"
}
```

Unknown message types receive:

```json
{
  "type": "unknown",
  "receivedType": "someType"
}
```

On successful connection, the server immediately sends:

```json
{
  "type": "connected",
  "message": "welcome"
}
```

## Ping

Request:

```json
{
  "type": "ping"
}
```

Response:

```json
{
  "type": "pong",
  "at": 1760000000000
}
```

The `at` value is a server-side Unix timestamp in milliseconds.

## Queue Check

`queueCheck` streams character lookup data for one or two teams.

Request envelope:

```json
{
  "type": "queueCheck",
  "data": "2[Adventureman:argent-dawn:eu(254)|Oifik:frostmane:eu(1480)][Aylanur:ravencrest:eu(103)|Onlylock:ragnaros:eu(267)]"
}
```

Payload format:

```text
bracketID[team1Entries][team2Entries]
```

The second team block is optional:

```text
bracketID[team1Entries]
```

Each entry uses:

```text
name:realm:region(specId)
```

Rules enforced by the current parser:

- `bracketID` must be numeric.
- Team blocks are separated by square brackets.
- Entries inside a team are separated by `|`.
- Each entry must contain exactly three `:` separated segments.
- The third segment must match `region(specId)`, for example `eu(73)`.
- Empty or malformed entries are rejected and reported without stopping valid
  entries from being queued.

### Queue Check Responses

After validating the bracket, the server sends bracket and team metadata:

```json
{
  "type": "bracketObj",
  "...": "bracket document fields"
}
```

```json
{
  "type": "team1IDs",
  "data": ["Adventureman:argent-dawn:eu(254)"]
}
```

```json
{
  "type": "team2IDs",
  "data": ["Aylanur:ravencrest:eu(103)"]
}
```

`team2IDs` is only sent when a second team is provided.

Character responses are streamed as each lookup completes:

```json
{
  "type": "charData",
  "initSearch": "Adventureman:argent-dawn:eu(254)",
  "searchSpecRequested": {
    "...": "specialization document fields"
  },
  "data": {
    "...": "character document fields"
  }
}
```

When a character is not found or a lookup fails, `data` is omitted because the
server sends `undefined` through the response helper:

```json
{
  "type": "charData",
  "initSearch": "Adventureman:argent-dawn:eu(254)"
}
```

Rejected entries are reported with counts:

```json
{
  "type": "queueCheckRejected",
  "rejectedEntries": [
    {
      "entry": "bad-entry",
      "reason": "entry must have exactly 3 segments"
    }
  ],
  "rejectedCount": 1,
  "queuedCount": 2
}
```

Errors use message-style responses:

```json
{
  "type": "error",
  "message": "Unknown queueCheck bracket ID.",
  "at": 1760000000000,
  "bracketID": 999,
  "rawData": "999[Adventureman:argent-dawn:eu(254)]"
}
```

If no valid entries remain after parsing, the server sends:

```json
{
  "type": "error",
  "message": "No valid queueCheck entries were found.",
  "at": 1760000000000,
  "rejectedEntries": []
}
```

## Heartbeat And Disconnects

The server maintains a heartbeat for connected clients:

- Every 30 seconds the server pings open clients.
- Clients are expected to answer with a WebSocket pong frame.
- A client that misses the heartbeat is terminated.

For `queueCheck`, the handler creates an `AbortController`. If the client socket
closes while lookups are still running, pending character retrieval work is
aborted and no more responses are sent for that request.

## Internal Code Layout

- `src/WS.js` - service entrypoint, HTTP upgrade handling, origin checks,
  heartbeat, connection lifecycle.
- `src/WS/wsRouter.js` - JSON parsing and message routing.
- `src/WS/wsHandlers/pingHandler.js` - `ping` message handler.
- `src/WS/wsHandlers/queueCheckHandler.js` - `queueCheck` parsing, validation,
  character retrieval, and queue enqueueing.
- `src/WS/wsHandlers/unknownHandler.js` - fallback for unknown message types.
- `src/WS/helpers/wsResponseHelpers.js` - response envelope helpers.
- `src/WS/helpers/pipeUserInput.js` - `queueCheck` payload parser.
- `src/WS/helpers/wsAuthContext.js` - cookie parsing, JWT validation, user
  lookup, and fingerprint verification for WS connections.

Shared dependencies used by the service:

- `src/helpers/threadBoot.js` - connects Redis, MongoDB, and the character cache
  subscriber.
- `src/corsSetup.js` - origin allowlist.
- `src/caching/characters/charCache.js` - character retrieval through workers.
- `src/caching/charQueueCache/jobQueueCache.js` - job queue enqueueing.
- `src/caching/gameBrackets/gameBracketsCache.js` - bracket lookup.
- `src/caching/gameSpecializations/gameSpecializationsCache.js` - specialization
  lookup.

## Development Notes

- Add new message types in `src/WS/wsRouter.js` and place handler logic under
  `src/WS/wsHandlers`.
- Authenticated handlers should read `ws.user` and `ws.JWT`; do not parse raw
  cookies inside individual handlers.
- Use `wsMessage` for `{ type, message, ...extra }` payloads.
- Use `wsResponse` for data payloads. Plain objects are merged into the top-level
  response; non-objects are wrapped as `data`.
- Keep handlers tolerant of malformed client input. The router catches invalid
  JSON, and handlers should report validation errors over the socket.
- Avoid long blocking work inside the message event. `queueCheck` starts
  character retrieval asynchronously and streams results as they resolve.
- Preserve close/abort behavior for any new long-running handler.

## Manual Smoke Test

Start the service:

```powershell
npm run devWS
```

Connect to the configured endpoint and send:

```json
{"type":"ping"}
```

Expected response:

```json
{"type":"pong","at":1760000000000}
```

For Docker Compose, connect to:

```text
ws://localhost:4001/
```

For local development without `WSPORT`, connect to:

```text
ws://localhost:8080/
```
