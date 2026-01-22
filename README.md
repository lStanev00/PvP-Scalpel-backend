# PvP Scalpel Backend (DBMS)

REST API and background services for the PvP Scalpel guild site. This service
handles guild rosters, PvP ladders, character search, posts, authentication,
weekly ladders, and CDN metadata. The API also serves the desktop ecosystem
for `louncher` and the desktop helper app. Production API lives on branch
`production`.

## Stack
- Node.js 20 + Express
- MongoDB + Mongoose
- Redis (cache and token storage)
- Worker threads for background services
- Resend for transactional email
- Blizzard API integration

## Project layout
- `DBMS.js` - API entry point
- `src/controllers` - REST route handlers
- `src/Models` - Mongoose schemas
- `src/caching` - Redis caches and Blizzard token cache
- `src/services` - background jobs
- `src/workers` - worker thread bootstrap
- `src/helpers` - shared utilities

## Quick start
1. Install dependencies:
   `npm install`
2. Create a `.env` in the repo root (same level as `package.json`).
3. Start MongoDB and Redis locally.
4. Start the API:
   `npm start`

The worker thread starts automatically and warms caches in the background.

## Environment variables

Required:
- `PORT` - API port.
- `MONGODB_CONNECTION` - MongoDB connection string.
- `JWT_SECRET` - signing secret for auth cookies.
- `CLIENT_ID` - Blizzard API client id.
- `CLIENT_SECRET` - Blizzard API client secret.
- `RESEND_API_KEY` - Resend API key.
- `IS_LOCAL` - `true` to use `REDIS_URL`, `false` to use `REDIS_PASSWORD` and `REDISPORT`.
- `REDIS_URL` - local Redis URL (used when `IS_LOCAL=true`).
- `REDIS_PASSWORD` - Redis password (used when `IS_LOCAL=false`).
- `REDISPORT` - Redis port (used when `IS_LOCAL=false`).
- `CDN_PRIVATE_DOMAIN` - internal CDN host for refreshes.
- `CDN_PORT` - internal CDN port.
- `JWT_CDN_PUBLIC` - token for CDN requests.

Optional / legacy:
- `TESTDEV`
- `TUNNELNAME`
- `REDIS_PUBLIC_URL`

## Scripts
- `npm start` - run the API (`DBMS.js`).
- `npm run logWeekly` - log weekly ladder data.
- `npm run patch` - run the guild patch service (legacy script)

## Required headers and auth
- All requests must include header `600: BasicPass`.
- If the request `Origin` is `http://tauri.localhost`, also include header
  `desktop` with the configured value in `src/middlewares/authMiddleweare.js`.
- Auth uses a signed JWT cookie named `token`.
- Login and registration require a `fingerprint` object.

![Fingerprint example](README_ASSETS/fprint.png)

## REST API
All endpoints return JSON and expect JSON bodies where applicable.

### Guild and roster
- `GET /member/list` - guild roster sorted by rank.

### PvP ladders
- `GET /LDB/2v2`
- `GET /LDB/3v3`
- `GET /LDB/solo`
- `GET /LDB/blitz`
- `GET /LDB/BG`
- `GET /LDB/topAll` - top entry for each bracket.

### Character search and updates
- `GET /searchCharacter?search=...` - search by character text.
- `GET /checkCharacter/:server/:realm/:name` - cached character lookup.
- `PATCH /patchCharacter/:server/:realm/:name` - refresh full character data.
- `PATCH /patchPvPData/:server/:realm/:name` - refresh PvP rating data only.

### Weekly ladder
- `GET /weekly` - weekly ladder data for all brackets.
- `GET /weekly/:bracket` - single bracket, valid values:
  `2v2`, `3v3`, `shuffle`, `blitz`, `RBG`.

### Posts
- `POST /new/post`
- `PATCH /edit/post`
- `DELETE /delete/post`
- `GET /get/posts`
- `GET /get/user/posts`

### User actions
- `GET /like/:charID` - toggle like for a character.
- `GET /favorite/:charID` - toggle favorite for a character.

### Authentication and accounts
- `POST /login`
- `POST /register`
- `PATCH /change/email`
- `PATCH /change/password`
- `PATCH /change/username`
- `POST /reset/password` - start password reset.
- `PATCH /reset/password` - confirm password reset.
- `PATCH /validate/token` - verify email or email change.
- `GET /verify/me` - current session info.
- `GET /logout`

### CDN
- `GET /CDN/manifest` - current CDN manifest.
- `GET /CDN/download/:key` - cached download URL for `addon`, `desktop`, or `launcher`.
- `GET /CDN/download/refresh` - refresh all download URLs.
- `GET /CDN/download/refresh?key=addon|desktop|launcher` - refresh one key.

## Background services
The worker thread (`src/workers/servicesWorker.js`) runs scheduled tasks:
- Initial cache warmup.
- Realm updates (about every 24.8 days).
- Guild member refresh (hourly).
- Achievement refresh (weekly).
- Weekly ladder rollups are computed during guild updates.

## License
See `LICENSE.md`.
