# BracketTops Documentation

`BracketTops` stores fetched Blizzard PvP leaderboard snapshots by bracket, season, and
region. The record `_id` is a composite key, and the stored `bracket` field uses the
Blizzard bracket id, not the local `GameBrackets._id`.

## Key Formats

Static brackets use the local `GameBrackets.slug`:

```text
{gameBracket.slug}:{seasonID}:{serverSlug}
```

Example:

```text
3v3:41:eu
```

Dynamic solo brackets use the full Blizzard leaderboard name:

```text
{blizResponse.name}:{seasonID}:{serverSlug}
```

Example:

```text
shuffle-hunter-beastmastery:41:eu
```

## Key Parts

- `gameBracket.slug`: local bracket slug from `GameBrackets`, such as `2v2`, `3v3`,
  `rbg`, `shuffle`, or `blitz`.
- `blizResponse.name`: Blizzard leaderboard name. Dynamic solo class/spec ladders use
  this directly, for example `blitz-demonhunter-vengeance`.
- `seasonID`: Blizzard PvP season id from `blizResponse.season.id`.
- `serverSlug`: region/server slug parsed from `blizResponse._links.self.href`, such as
  `eu`.

## Stored Fields

- `_id`: composite key described above.
- `region`: local `Region._id`.
- `season`: Blizzard PvP season id.
- `bracket`: Blizzard bracket id from `blizResponse.bracket.id`.
- `bracketDoc`: virtual relation to `GameBrackets`, matched by
  `BracketTops.bracket -> GameBrackets.blizID`.
- `class`: local `GameClass._id`; only set for dynamic solo class/spec brackets.
- `specialization`: local `GameSpecialization._id`; only set for dynamic solo
  class/spec brackets.
- `characters`: ranked leaderboard rows in the shape `{ search, rating, rank }`.

## Blizzard Bracket IDs

Blizzard leaderboard responses provide `bracket.id` and `bracket.type`. Current known
mapping:

```text
ARENA_2v2     -> blizID 0 -> slug 2v2
ARENA_3v3     -> blizID 1 -> slug 3v3
BATTLEGROUNDS -> blizID 3 -> slug rbg
SHUFFLE       -> blizID 6 -> slug shuffle
BLITZ         -> blizID 8 -> slug blitz
```

`GameBrackets.blizID` stores this Blizzard id. The local `GameBrackets._id` remains a
separate internal id.

## Formatter Behavior

`formatBracketTops` resolves `GameBrackets` by `blizID` using
`getGameBracketByBlizID(blizResponse.bracket.id)`.

If no bracket is found by `blizID`, the formatter derives a slug from
`blizResponse.name`, finds the matching `GameBrackets` row by `slug`, patches
`GameBrackets.blizID`, refreshes the game bracket cache, and retries the lookup.

When a `BracketTops` record is saved, the formatter uses `updateOne(..., { upsert:
true })`. Existing records with the same `_id` are patched, and `characters` is replaced
with the latest leaderboard rows.

## Non-Obvious Notes

- `BracketTops.bracket` is not a normal Mongoose `ref`; it stores Blizzard's bracket id,
  not `GameBrackets._id`.
- Use `bracketDoc` when populating the related `GameBrackets` row.
- Solo overall leaderboards like `shuffle-overall` and `blitz-overall` are not class/spec
  ladders and should not be handled like dynamic class/spec keys.
- Specialization names can be ambiguous across classes, such as `Protection`. The
  formatter validates `specDoc.relClass === classDoc._id`.
- Historical bad records such as `:41:eu` or `shuffle:41:eu` came from older static
  handling and may require manual database cleanup.
