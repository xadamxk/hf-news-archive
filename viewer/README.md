# HF News Archive Viewer

Static React app (Vite + Bun) to browse aggregated HF News `events.json` data.

## Data bundle

`public/events.json` is **generated** — compact minified JSON (`v`, `n`, `a[]` with short keys `c,t,d,l,u,e,s`). Regenerate after changing edition files:

```bash
cd viewer
bun install
bun run data
```

From repository root:

```bash
bun run viewer/scripts/aggregate.ts
```

## Development

```bash
cd viewer
bun run data   # once, if public/events.json is missing
bun run dev
```

## Production static build

```bash
cd viewer
bun run build
```

Output: `viewer/dist/`. Serve `dist/` with any static host; keep `base: './'` so assets resolve when opened from a subpath.

## Filters

- **Search**: substring in title + description (case-insensitive).
- **Category**: exact match on event category.
- **User**: substring match on any linked user’s UID or username (case-insensitive).

Profile links use `https://hackforums.net/member.php?action=profile&uid=` + UID.
