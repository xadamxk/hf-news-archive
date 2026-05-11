# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository purpose

Archive of every Hack Forums News edition. Each edition lives in `editions/<N>/` and contains:

- `posts.json` — raw thread posts fetched from the HF API (forum-thread editions)
- `blogs.json` — raw blog payload (member-blog editions, e.g. 442–508)
- `events.json` — curated structured summary derived from the raw source

The `viewer/` app aggregates every `events.json` into a single compact bundle and renders a browsable static site.

## Common commands

Fetch raw posts for a contiguous range of editions (writes `editions/<N>/posts.json`, skips those already populated):

```bash
node scripts/fetch_posts.js --start <N> --end <M> --token <HF_API_TOKEN>
```

Source-of-truth for which thread maps to which edition: `editions.csv` (`Extracted,Edition,Link,Name,Note`). The fetcher reads it from the repo root.

Viewer (run from `viewer/`, requires Bun):

```bash
bun install
bun run data    # regenerate public/events.json from all editions/*/events.json
bun run dev     # local Vite dev server
bun run build   # static build to viewer/dist/ (prebuild auto-runs `data`)
```

`bun run data` is equivalent to `bun run viewer/scripts/aggregate.ts` from the repo root. **Always re-run it after adding or editing any `editions/*/events.json`** — `viewer/public/events.json` is generated, not hand-edited.

## Authoring events.json (manual curation)

`prompts/parse-prompt.txt` is the canonical spec. Key rules to keep in mind across edits:

- Events are categorized as: `site`, `users`, `groups`, `threads`, `interviews`, `news`. Definitions and bundling rules are in the prompt; follow them — they are load-bearing for filtering in the viewer.
- Every edition ends with a single `news` event titled exactly `"Contributors to this edition."` with empty `users`.
- `edition` block: `number`, `date` (unix int from the first post), `pid`, `author_uid`, `subject`. For blog-sourced editions, also include `bid` and set `pid: ""`.
- Skip off-site world/tech/gaming/anime/comics/horoscope columns — they are not HF events.
- Notable threads are included as `threads` events **only when listed in the edition's notable-thread section.**

### Resolving usernames from `[mention=NNN]` tags

`posts.json` bodies contain `[mention=<uid>]` tags with no inline username. To resolve them, fetch the rendered thread page using a `mybbuser` cookie (the user supplies it; it is not stored in the repo) with a normal browser User-Agent (HF returns 403 to default curl UAs), and grep for `profile&uid=NNN]...Username]`. Save HTML to `%TEMP%` (`C:/Users/xadam/AppData/Local/Temp/`) — bash's `/tmp` does not map to the same path Python sees on Windows, so prefer absolute Windows paths when piping curl output into Python. When a uid cannot be resolved (e.g. linked image with no name), use `username: "Unknown"`.

Blog editions (`blogs.json`) inline usernames inside `[url=...uid=NNN]Username[/url]` BBCode, so no auth is needed for blog parsing.

## Aggregation schema (viewer/public/events.json)

Compact short-key shape produced by `viewer/scripts/aggregate.ts`:

- `ed[]` — edition rows: `{ e: number, s: subject, p: pid, a: author_uid, h: date }` (also `b: bid` for blog editions)
- `n` — total event count
- `a[]` — events: `{ c: category, t: title, d: description, l: url, u: users[], x: index into ed[] }`

The viewer (`viewer/src/App.tsx`) consumes this directly. Filters: search (substring on title+description, case-insensitive), category (exact), user (substring on uid OR username). Profile links resolve to `https://hackforums.net/member.php?action=profile&uid=<UID>`.

There are also one-off maintenance scripts in `viewer/scripts/` (`fix-interview-urls.ts`, `migrate-edition-meta.ts`, `normalize-role-separators.ts`, `standardize-interview-titles.ts`) — read them before running; they mass-rewrite `events.json` files.

## Gaps and conventions to preserve

- Edition 504 has no source data — leave the gap.
- "Unofficial Edition // October 18, 2019" (`HF-News-Unofficial`) is intentionally not assigned a number.
- When linter rewrites multi-line user objects in `events.json`, that's the established style — keep it.
