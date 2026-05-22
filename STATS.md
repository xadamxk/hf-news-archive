# Stats Data Reference

Each HF News edition with statistics has a **`editions/<N>/stats.json`** file
holding the numeric snapshot in a human-readable, semantically nested form.
That file is the source-of-truth; hand-edits are supported.

The aggregator `viewer/scripts/aggregate-stats.ts` reads every per-edition
file and emits the minified, short-key payload at `viewer/public/stats.json`
for the viewer to consume.

This document explains the per-edition file format, the original tab-name
normalization that was applied during the one-time bootstrap, and the
data-quality issues from the published-source BBCode that were auto-corrected
into the per-edition files.

## Per-edition file format

A complete `editions/<N>/stats.json` looks like this:

```json
{
  "edition": 231,
  "site_statistics": {
    "total_posts": 45222373,
    "total_threads": 3229550,
    "total_members": 2648746
  },
  "ban_statistics": {
    "last_week": {
      "staff_bans": 81,
      "vacation_bans": 16,
      "combined_bans": 97
    },
    "total": {
      "staff_bans": 735,
      "vacation_bans": 93,
      "combined_bans": 828
    }
  },
  "forum_counts": {
    "notable_sections": {
      "lounge": { "threads": 417852, "posts": 5906784 },
      "ranf":   { "threads": 44452,  "posts": 583575 }
    },
    "tabs": {
      "general":    { "threads": 660538, "posts": 9174371 },
      "hacking":    { "threads": 620045, "posts": 5444872 },
      "computing":  { "threads": 186513, "posts": 1590937 },
      "coding":     { "threads": 150764, "posts": 1307702 },
      "gaming":     { "threads": 384927, "posts": 3996573 },
      "vip":        { "threads": 111869, "posts": 1049643 },
      "groups":     { "threads": 5988,   "posts": 258616 },
      "webmaster":  { "threads": 71837,  "posts": 526932 },
      "graphics":   { "threads": 121584, "posts": 921335 },
      "marketplace":{ "threads": 777680, "posts": 7292403 },
      "money":      { "threads": 122226, "posts": 1652249 }
    }
  }
}
```

**Any section or subblock can be omitted** if the edition didn't publish it.
Don't write nulls — just leave the key out.

### Section reference

| Field | Meaning |
|---|---|
| `edition` | Edition number (mirrors the directory name) |
| `site_statistics.total_posts` | Cumulative posts at snapshot time |
| `site_statistics.total_threads` | Cumulative threads |
| `site_statistics.total_members` | Cumulative registered members |
| `ban_statistics.last_week.staff_bans` | Staff bans in prior week |
| `ban_statistics.last_week.vacation_bans` | Vacation bans in prior week |
| `ban_statistics.last_week.combined_bans` | Combined total prior week |
| `ban_statistics.total.staff_bans` | Cumulative staff bans |
| `ban_statistics.total.vacation_bans` | Cumulative vacation bans |
| `ban_statistics.total.combined_bans` | Cumulative combined |
| `forum_counts.notable_sections.lounge.{threads,posts}` | Lounge counts |
| `forum_counts.notable_sections.ranf.{threads,posts}` | RANF counts |
| `forum_counts.tabs.<canonical>.{threads,posts}` | Per-tab counts |

The aggregator translates each path above to a short key in the minified
`viewer/public/stats.json`. The mapping is documented in the
`aggregate-stats.ts` header comment.

## What is intentionally NOT captured

These were deliberately skipped during design:

- **Delta percentages and absolute deltas** (e.g. `+0.17%`, `-975`). Trivially
  recomputable from consecutive editions' raw values; storing them per
  snapshot wastes bytes and risks staleness if a value is later corrected.
- **Posts Per Member, Replies Per Thread**. Derived ratios computable from
  `tp`/`tm` and `tp`/`tt`; present in only some editions, so storing them
  introduces inconsistency.
- **Per-staff/private-group counts** (Null, Specialists, Red Lions, Echo,
  Brotherhood, Titans, etc. — see the full list in
  `scripts/detect_stats_coverage.js` exploration). The group roster churned
  heavily across editions with no clean canonical mapping; capturing them
  per edition triples the variation problem with little cross-edition
  comparability.

## Tab name normalization (applied at bootstrap)

The per-edition files use a **canonical set of tab keys** (`general`,
`hacking`, `computing`, …). The original BBCode used era-specific names
(`Common` vs `General`, `Hack` vs `Hacking`, etc.) — those were folded into
the canonical set during the one-time bootstrap that built the per-edition
files. Use these canonical keys when adding stats for new editions:

| Canonical key | Original BBCode variants seen across eras |
|---|---|
| `general` | General · Common · Life · General Topics |
| `hacking` | Hacking · Hack |
| `computing` | Computing · Tech |
| `coding` | Coding · Code |
| `gaming` | Gaming · Game |
| `vip` | VIP Area · VIP |
| `groups` | Groups |
| `webmaster` | Webmaster · Webmasters · Web |
| `graphics` | Graphics · GFX |
| `marketplace` | Marketplace · Market |
| `money` | Money |

Tab names outside this set (private-group names like `Red Lions`, `Echo`,
`Titans`) are intentionally not captured.

## Source format coverage

The published stats format changed several times across the archive:

| Editions | Format in `posts.json` / `blogs.json` | How stats.json gets populated |
|---|---|---|
| 1 – 441, 509 – 539 | "Site Statistics" / "Ban Statistics" / "Forum Counts" headings, BBCode `[list][*]` totals | Original bootstrap (BBCode parser, now retired) |
| 442 – 508 | `blogs.json` — mostly no stats; a handful (489–495, 499–503, 505–509) restored the structured block | Same as above, applied to `blogs.message` |
| 540 – 541 | Plain-text "Total" / "Average" sections (same field names, no `[list][*]` wrapper) | One-off parser; values are cumulative totals, written directly |
| 542 | Daily-deltas text — anchored by `Total new posts` / `…threads` / `…members` | One-off parser; **chains weekly delta onto ed 541's cumulative** |
| 543 | Daily-deltas as a BBCode `[table]` with 7 rows | One-off parser; sums the rows, **chains onto ed 542** |
| 544 – 554 | Daily-deltas as **screenshot images** under the `statistics-header.png` banner (imgur / gyazo / imgbb) — same 7×3 grid format, just rasterized | Numbers were **manually transcribed** while viewing each image, then chained onto the previous edition's cumulative totals |
| 555 – 585 | Daily-deltas as **screenshot images** under the new `statistics-magenta.png` banner (all gyazo); each edition shows a "this week" + "last week" pair | Same as 544–554: transcribed by viewing each "this week" image, chained off ed 554. Ed 558 published 8 daily rows (one more than the usual 7) — that didn't affect the stored values since only cumulative totals are kept |

## Coverage summary

Snapshot of how many editions carry stats (refresh by running
`node scripts/detect_stats_coverage.js` after adding editions).

| Section | Editions with it | Earliest | Latest |
|---|---|---|---|
| Site Statistics | 323 | 207 | 585 |
| Ban Statistics | 204 | 207 | 511 |
| Forum Counts | 268 | 207 | 511 |
| All three together | 204 | 207 | 511 |

The densest cross-edition window is **207 – 399** — most editions in that
range carry all three sections. Coverage degrades in editions 400+ as
sections were dropped or moved out of the formatted block; the blog era
(442 – 508) only sporadically restored them. Editions 540 – 585 carry only
the site-statistics block (no ban or forum data); editions 555 – 585
specifically come from screenshot transcription rather than text parsing.

### Delta-chain derivation (editions 542+)

For editions 542 onward the published source carries **weekly deltas**
rather than cumulative totals (per-day breakdowns of new posts / threads /
members). Each edition's `total_*` is computed by adding its weekly
`new_posts` / `new_threads` / `new_members` to the previous edition's
cumulative `total_*`. The previous edition's totals are the published
values for ≤541 and the chained values for 542+.

### Growth between editions (chart derivation)

The Statistics tab's second chart section ("Site Statistics — Growth
Between Editions") is derived **on the fly in the viewer** from the
cumulative totals — nothing about it lives in `stats.json`. For each
edition `N`:

```text
posts_added(N)   = total_posts(N)   − total_posts(prev_edition_with_stats)
threads_added(N) = total_threads(N) − total_threads(prev_edition_with_stats)
members_added(N) = total_members(N) − total_members(prev_edition_with_stats)
```

The "prev_edition_with_stats" is whatever edition before `N` had a value
for that specific field — so a gap (e.g. blog era editions without stats)
just means the next stats-bearing edition's growth represents the whole
elapsed period.

This metric is **the same across every format era**: for editions ≤541
it's the delta between consecutively-published cumulative snapshots; for
542+ it equals the journalist's published weekly_total exactly (since the
cumulative was chained from that weekly_total). Long publishing gaps —
e.g. ed 539 (Nov 2023) → ed 540 (Jun 2025) — show as honestly-large
spikes because they represent ~18 months of real growth condensed into
one data point.

No daily-average fields are stored per edition any more; the lifetime
running average that the journalist printed for editions ≤541 is
intentionally not surfaced because it's an average across all of HF's
history, not a point-in-time value for the published edition.

## Known gotchas and data-quality issues

The published-source BBCode contained a few transcription mistakes that
**were auto-corrected during the one-time bootstrap** when the per-edition
files were created. The corrections are now baked into the source-of-truth
files and the minified viewer payload.

Going forward, the per-edition files are editable — if a future edition is
added with a similar bug, fix it directly in `editions/<N>/stats.json` and
re-run `bun run --cwd viewer data`.

### 1. Inflated daily-figure values (editions 314, 358 – 396) — **historical**

A range of editions originally published daily-average values inflated by
exactly 100× (e.g. `13,486.84` written as `1,348,684` — almost certainly
a delimiter mistake). The bootstrap divided those 86 affected values by
100, then later the `daily_*` fields were removed from per-edition files
entirely (see [Growth between editions](#growth-between-editions-chart-derivation)
— point-in-time growth is now derived from cumulative totals instead).
This gotcha is preserved here only as archive history; no field carrying
those values exists in `stats.json` today.

### 2. `total_posts` / `total_threads` labels swapped (editions 465 – 511) — **corrected**

37 editions (465 – 471, 474 – 481, 483 – 484, 489 – 497, 499 – 503,
505 – 511) published `Posts:` and `Threads:` with the labels transposed —
the source had `total_posts < total_threads`, which inverts the real-world
relationship. The bootstrap detected `tp < tt` and swapped the two values.
The per-edition files now hold the corrected (realistic) ordering.

### 3. Ban Statistics drop out after ~441

Editions 442+ (the blog era) mostly omit the `Ban Statistics` block. A few
late blog editions (489 – 495, 499 – 503, 505 – 509, 511) restored it. The
omission is genuine — the source just didn't carry those numbers. Run
`node scripts/detect_stats_coverage.js` to see per-edition coverage.

### 4. `Combined Bans: 828 - 93` style (ed 231)

A few editions write the combined-bans line as `Combined Bans: 828 - 93`
where the second number subtracts vacation bans from the total. The original
parser took the first number (`828`) as `combined_bans`, which matches the
semantic. No correction applied — flagged here only so the layout doesn't
surprise anyone reading the source BBCode.

## Adding stats for a new edition

The current archive runs through ed 585. New editions arrive periodically
and follow the same screenshot-image format that ed 555 – 585 use. This
section is the self-contained workflow.

### Prerequisites

- `editions/<N>/posts.json` exists for the new edition (fetch via
  `node scripts/fetch_posts.js --start <N> --end <N> --token <HF_API_TOKEN>`;
  see `CLAUDE.md` for details).
- `editions/<N>/events.json` exists (per the standard authoring flow).

### Step 1 — locate the stats section

Open `editions/<N>/posts.json` and concatenate every post's `message`.
Search for a banner image hosted at
`hackforums.net/images/hfnews/statistics-*.png` — the suffix has changed
across eras (`statistics-header.png`, `statistics-magenta.png`, possibly a
future color). **Any banner whose filename starts with `statistics-`
under `hfnews/` counts.** If no such banner exists in any post, the edition
has no stats — don't write `stats.json`.

### Step 2 — find the "this week" image

Right after the banner, the post normally contains **two `[img]` tags**:

1. **This week's** Forum Activity Stats screenshot — the one you'll
   transcribe.
2. **Last week's** screenshot — a duplicate reference to the prior
   edition's image, which you've already processed. Ignore it.

Take the FIRST `[img]` URL after the banner. Edge cases:

- If the post has only one stats image, that's "this week" (the journalist
  occasionally omits the last-week reference).
- If the post has three or more images, inspect them — usually the first is
  still the right one, but a header GIF or banner image can appear before
  the data table. Skip any image whose URL points at
  `hackforums.net/images/hfnews/` or that's an obvious header/divider.
- Image hosts seen so far: `i.imgur.com`, `i.gyazo.com`, `i.ibb.co`.
  A future edition might use a new host — that's fine, the rule is "first
  off-site image after the stats banner."

### Step 3 — view and transcribe

Download the image to `%TEMP%`:

```powershell
$ua = "Mozilla/5.0"
Invoke-WebRequest -UserAgent $ua -Uri "<url>" -OutFile "$env:TEMP\hfnews_edN.png"
```

View it with the Read tool (Claude Code) or any image viewer. The image
contains a "Forum Activity Stats (Last 7 Days)" table with columns
**Date / Posts / Threads / Members**.

Transcribe every row into a `[posts, threads, members]` tuple. **Use the
actual row count** — most editions show 7 rows, but ed 558 published 8
and future editions may vary. Don't hard-code 7.

### Step 4 — compute the values

Given the previous edition's cumulative totals from
`editions/<N-1>/stats.json` (skip backwards if N-1 has no stats.json):

```text
weekly_posts   = Σ row[i][0] for i in rows
weekly_threads = Σ row[i][1]
weekly_members = Σ row[i][2]

total_posts(N)   = total_posts(N-1)   + weekly_posts
total_threads(N) = total_threads(N-1) + weekly_threads
total_members(N) = total_members(N-1) + weekly_members
```

That's all you need — no `daily_*` or per-week-rate fields belong in
the per-edition file. The Statistics tab derives growth-between-editions
on the fly from the cumulative totals (see [Growth between editions]
(#growth-between-editions-chart-derivation)).

### Step 5 — write the per-edition stats.json

Write `editions/<N>/stats.json` using exactly this shape (editions 542+
carry only `site_statistics`, no ban or forum blocks):

```json
{
  "edition": <N>,
  "site_statistics": {
    "total_posts": ...,
    "total_threads": ...,
    "total_members": ...
  }
}
```

Use 2-space indentation and a trailing newline (matches the rest of the
archive's per-edition stats files).

### Step 6 — regenerate the viewer payload

```bash
bun run --cwd viewer data
```

This re-runs all three aggregators (events, contributors, stats) and
rewrites `viewer/public/stats.json` to include the new edition.

### Step 7 — sanity-check the new row

Run a neighbor-comparison to catch transcription typos:

```bash
node -e "
const d=require('./viewer/public/stats.json');
const sorted=[...d.s].sort((a,b)=>a.e-b.e);
let prev=null;
for (const r of sorted) {
  if ([N-2, N-1, N, N+1].includes(r.e)) {
    const added = prev && prev.tp!=null && r.tp!=null ? r.tp - prev.tp : '(no prev)';
    console.log('ed', r.e, 'tp:', r.tp, 'tt:', r.tt, 'tm:', r.tm, 'posts_added:', added);
  }
  prev = r;
}
"
```

(replace `N` with the new edition number). Verify:

- `tp` / `tt` / `tm` increase monotonically from the prior edition.
- `posts_added` matches the sum of the daily rows in the source screenshot
  (currently ~2,500–5,000 for 2025–2026 forum activity; spikes >10,000 or
  drops to 0 warrant a recheck).

If a value looks wildly off (e.g. 10× a neighbor), the most likely cause
is a transcription typo or a dropped/extra digit in one of the daily
rows. Open the per-edition `stats.json`, fix the totals, re-run
`bun run --cwd viewer data`.

### Refresh coverage numbers (optional)

The [Coverage summary](#coverage-summary) table is a snapshot. Update it
by running `node scripts/detect_stats_coverage.js` and copying the new
headline counts.

## Editing existing data

The source-of-truth for stats is `editions/<N>/stats.json`. Hand-edit those
files when fixing a number that's wrong (the bootstrap auto-corrections
documented in [Known gotchas](#known-gotchas-and-data-quality-issues) are
not exhaustive — if you spot another anomaly, edit the file directly).
After editing, re-run `bun run --cwd viewer data`.

`scripts/detect_stats_coverage.js` is a read-only diagnostic that prints
per-edition `site/ban/forum` coverage to stdout — useful for refreshing
the [Coverage summary](#coverage-summary) numbers when adding editions.
