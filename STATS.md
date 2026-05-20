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
    "total_members": 2648746,
    "daily_posts": 13985,
    "daily_threads": 999,
    "daily_new_members": 819
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
| `site_statistics.daily_posts` | Average posts/day |
| `site_statistics.daily_threads` | Average threads/day |
| `site_statistics.daily_new_members` | Average new registrations/day |
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
| 544 – 554 | Daily-deltas as **screenshot images** (imgur / gyazo / imgbb) — same 7×3 grid format, just rasterized | Numbers were **manually transcribed** while viewing each image, then chained onto the previous edition's cumulative totals |
| 555 – 585 | **No stats section in the source post at all** | No `stats.json` file written; coverage genuinely ends at ed 554 |

## Coverage summary

Snapshot of how many editions carry stats (refresh by running
`node scripts/detect_stats_coverage.js` after adding editions).

| Section | Editions with it | Earliest | Latest |
|---|---|---|---|
| Site Statistics | 292 | 207 | 554 |
| Ban Statistics | 210 | 207 | 511 |
| Forum Counts | 274 | 207 | 511 |
| All three together | 204 | 207 | 511 |

The densest cross-edition window is **207 – 399** — most editions in that
range carry all three sections. Coverage degrades in editions 400+ as
sections were dropped or moved out of the formatted block; the blog era
(442 – 508) only sporadically restored them. Editions 540 – 554 carry only
the site-statistics block (no ban or forum data). Editions 555+ carry no
stats at all.

### Delta-chain derivation (editions 542 – 554)

For editions 542 onward the published values are **weekly deltas** rather
than cumulative totals. Each edition's `total_*` is computed by adding its
weekly `new_posts` / `new_threads` / `new_members` to the previous edition's
cumulative `total_*`. `daily_*` fields are computed as `weekly_total / 7`,
so they represent that week's daily average rather than a forum-lifetime
average (which is what they meant for editions ≤541). Keep that in mind
when comparing daily-average lines across the format-shift boundary.

## Known gotchas and data-quality issues

The published-source BBCode contained a few transcription mistakes that
**were auto-corrected during the one-time bootstrap** when the per-edition
files were created. The corrections are now baked into the source-of-truth
files and the minified viewer payload.

Going forward, the per-edition files are editable — if a future edition is
added with a similar bug, fix it directly in `editions/<N>/stats.json` and
re-run `bun run --cwd viewer data`.

### 1. Inflated daily-figure values (editions 314, 358 – 396) — **corrected**

A range of editions published daily values inflated by exactly 100×, almost
certainly a delimiter mistake by the journalist (e.g. `13,486.84` written
as `1,348,684`). The bootstrap divided 86 affected values by 100 across
~30 editions. The per-edition files now hold the realistic values.

Pattern: `daily_posts` over 100,000, `daily_threads` over 50,000, and
`daily_new_members` over 10,000 were all divided by 100, preserving two
decimal places.

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

## Editing per-edition data

The source-of-truth for stats is `editions/<N>/stats.json`. Hand-edit those
files when:
- Adding stats for a newly-archived edition (write the file by following the
  example above; omit any sections the edition didn't publish).
- Fixing a number that's wrong (the bootstrap auto-corrections are not
  exhaustive — if you spot another anomaly, edit the file directly).

After editing, re-run the aggregator:

```bash
bun run --cwd viewer data
```

That re-runs all three aggregators (events, contributors, stats) and
regenerates `viewer/public/stats.json`.

`scripts/detect_stats_coverage.js` is a read-only diagnostic that prints
per-edition `site/ban/forum` coverage to stdout — useful for refreshing
the [Coverage summary](#coverage-summary) numbers when adding editions.
