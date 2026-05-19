# HF News Archive

A structured, off-site historical record of (almost) every Hack Forums News edition.

## Purpose

This repository preserves the events covered in each Hack Forums News edition — site changes, member awards, group activity, notable threads, contests, and the writers behind each edition — as machine-readable JSON. By keeping a curated mirror outside Hack Forums itself and outside the HF Wiki, the archive ensures the history survives thread deletions, account closures, temper tantrums, and any other future change to the site.

## Repository layout

- `editions/<N>/` — one folder per edition number. Contains the raw source (`posts.json` for thread-sourced editions, `blogs.json` for blog-sourced editions 442–508) and a curated `events.json` that summarizes the edition's events in a stable schema.
- `viewer/` — a small React + Vite + Bun static site for browsing the archive. See `viewer/README.md` for run instructions.
- `scripts/` — data-fetching helpers (notably `scripts/fetch_posts.js`).
- `prompts/` — the human + AI editorial prompts used when curating `events.json` from raw sources.
- `editions.csv` — the source-of-truth mapping from edition number to its thread URL and status (extracted, pending, or missing).

Deeper architecture notes live in `CLAUDE.md`.

## Missing editions

32 editions could not be archived because the source thread or blog post was deleted, junked, or never captured before the archive was started. These editions exist as numbers only — no raw data, and no curated events:

```
14, 15, 340, 341, 359, 472, 485, 486, 487, 488, 504, 512, 513, 514,
515, 516, 517, 518, 519, 520, 521, 522, 523, 524, 525, 526, 527, 528,
529, 530, 531, 532
```

Edition 359 still has a thread link in `editions.csv`, but its first post was junked, so no usable content remains. The list is generated from rows in `editions.csv` whose `Note` column reads `MISSING`.

## FAQ

### What is the purpose of this archive project?

To preserve the historical record of Hack Forums News events in a place that does not depend on Hack Forums itself or the HF Wiki. Both of those can change, lose content, or disappear; this repository keeps a portable, structured copy so the history remains accessible regardless of what happens to the primary site.

### I found an error or missing event, can you fix it?

The fastest path is to fix it yourself: clone the repository, edit the relevant `editions/<N>/events.json` (or add a new one), and open a pull request. Corrections, newly discovered events, and other improvements are all welcome.

### Where does the data come from?

Most editions are pulled from their Hack Forums thread via the HF API (`scripts/fetch_posts.js`), which writes the raw posts into `editions/<N>/posts.json`. Editions 442–508 were sourced from member blog dumps (`blogs.json`) instead. From there, each edition's `events.json` is curated by hand following the conventions in `prompts/parse-prompt.txt`.

### Why are some editions missing?

The source content is gone. Some news threads were deleted, junked, or migrated away before the archive existed; some blogs were never captured. The 32 affected edition numbers are listed above. If you have a copy of any of them, please open a pull request adding the source data.

### Is there a viewer / web UI?

Yes — the `viewer/` directory is a static React app for browsing every event in the archive. From `viewer/`, run `bun install` once, then `bun run dev` for a local dev server or `bun run build` to produce a static `dist/` you can deploy anywhere. See `viewer/README.md` for filter/search details.

### Can I contribute? How?

Pull requests are welcome. Common contributions: filling in details on existing events, adding events that were missed, or adding entire editions (especially anything from the missing list). The viewer uses Bun; the post fetcher uses Node and needs a Hack Forums API token. After editing `events.json` files, regenerate the viewer bundle with `bun run viewer/scripts/aggregate.ts` from the repo root.

### What do "Journalist (Section)" and "Contributor" roles mean?

On the `Contributors to this edition.` event, each contributor carries a `role` string. `Journalist (Headlines)`, `Journalist (Awards / Tech)`, etc. means that member wrote the named section(s) of the edition. `Contributor` means they appeared in the closing "thank you" credits without being attributed to a specific section.

### How often is the archive updated?

The archive is updated manually, so expect long gaps — sometimes months — between catch-up passes. New editions are added in batches when time allows rather than on a fixed schedule.

### License / data reuse terms?

Feel free to extract whatever you want from the `events.json` data for your own projects. If you do build something on top of the archive, please help keep it current by sending fixes and new editions back upstream so everyone benefits from the same history.

## TODO

- [ ] Create a script, utilizing the HF API, that queries UIDs and updates the corresponding usernames in the `users` entries
- [ ] Add FAB button to return to top of the page
- [ ] Add settings to viewer (pagination number, theme, etc.)
- [ ] Continue to update theme(s) to match old HF themes
- [ ] Add page/view for "News Contributor statistics"
- [ ] Add option for "infiniscroll" feature (mobile only?)
- [ ] Add either tags or sub-categories (ie. rules, awards, RKO's/Repfucks/rep kills, etc. for each existing category)
- [ ] Break up user event into multiple events (to know how many times individual users were banned, rko'd, etc.) — will drastically increase event count (might need further optimizations)
- [x] Update UI to be mobile compatible
- [x] Add HF News contributors for editions (357, 358, 360–471, 489–503, 505–511, 533–539)
- [x] Add HF News contributors page to viewer

### Potential Future Projects
- "HFdle" site or daily thread - quiz using historic events. Requires generating potential answers - question of the day vs continuous questions
- "During this Week" feature — events from this current week from past editions

### Random Notes
- Editions 83 & 183 feature self-interviews
- 