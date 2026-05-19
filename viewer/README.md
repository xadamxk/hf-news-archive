# HF News Archive Viewer

Static React app (Vite + Bun) to browse aggregated HF News `events.json` data.

## Data bundle

`public/events.json` is **generated** — compact minified JSON: `ed[]` (edition rows: `e,s,p,a,h`), `n` (event count), and `a[]` (events: `c,t,d,l,u,x` where `x` indexes `ed`). Regenerate after changing edition files:

```bash
cd viewer
bun install
bun run data
```

From repository root:

```bash
bun run --cwd viewer data
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
