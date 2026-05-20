/**
 * Aggregates each editions/<N>/stats.json (human-readable, snake_case,
 * semantically nested) into viewer/public/stats.json (minified, compact
 * short-key schema).
 *
 * The per-edition file is now the source-of-truth (see editions/231/stats.json
 * for an example). This script only translates and concatenates — no BBCode
 * parsing — so corrections/edits can be made by editing the per-edition file
 * directly and rerunning `bun run data`.
 *
 * Output schema — short keys to shrink the payload:
 *
 *   {
 *     "n": <number>,            // n = total editions with at least one section
 *     "s": [                    // s = stats array, one row per edition
 *       {
 *         "e": <number>,        // e = edition number
 *         // Site stats (omitted when absent)
 *         "tp": <number>,       // tp = total posts
 *         "tt": <number>,       // tt = total threads
 *         "tm": <number>,       // tm = total members
 *         "dp": <number>,       // dp = daily posts (average)
 *         "dt": <number>,       // dt = daily threads (average)
 *         "dm": <number>,       // dm = daily new members (average)
 *         // Ban stats (omitted when absent)
 *         "bs":  <number>,      // bs  = staff bans, last week
 *         "bv":  <number>,      // bv  = vacation bans, last week
 *         "bc":  <number>,      // bc  = combined bans, last week
 *         "bts": <number>,      // bts = staff bans, cumulative total
 *         "btv": <number>,      // btv = vacation bans, cumulative total
 *         "btc": <number>,      // btc = combined bans, cumulative total
 *         // Forum Counts > Notable Sections (omitted when absent)
 *         "lt": <number>,       // lt = Lounge threads
 *         "lp": <number>,       // lp = Lounge posts
 *         "rt": <number>,       // rt = RANF threads
 *         "rp": <number>,       // rp = RANF posts
 *         // Forum Counts > major tabs (canonical names)
 *         "tab": {
 *           "general":   { "t": <number>, "p": <number> },
 *           "hacking":   ..., "computing": ..., "coding": ...,
 *           "gaming":    ..., "vip": ..., "groups": ...,
 *           "webmaster": ..., "graphics": ...,
 *           "marketplace": ..., "money": ...
 *         }
 *       }
 *     ]
 *   }
 *
 * Sorted by edition number ascending.
 *
 * Run from repo root:  bun run viewer/scripts/aggregate-stats.ts
 * Or from viewer/:     bun run scripts/aggregate-stats.ts
 */
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const viewerRoot = join(__dirname, "..");
const repoRoot = join(viewerRoot, "..");
const editionsDir = join(repoRoot, "editions");
const outFile = join(viewerRoot, "public", "stats.json");

const editionDir = /^\d+(?:\.\d+)?$/;

type TabCounts = { threads?: number; posts?: number };
type EditionStats = {
  edition?: number;
  site_statistics?: {
    total_posts?: number;
    total_threads?: number;
    total_members?: number;
    daily_posts?: number;
    daily_threads?: number;
    daily_new_members?: number;
  };
  ban_statistics?: {
    last_week?: {
      staff_bans?: number;
      vacation_bans?: number;
      combined_bans?: number;
    };
    total?: {
      staff_bans?: number;
      vacation_bans?: number;
      combined_bans?: number;
    };
  };
  forum_counts?: {
    notable_sections?: {
      lounge?: TabCounts;
      ranf?: TabCounts;
    };
    tabs?: Record<string, TabCounts>;
  };
};

type CompactTab = { t?: number; p?: number };
type CompactRow = Record<string, unknown> & {
  e: number;
  tab?: Record<string, CompactTab>;
};

function compactTab(t: TabCounts | undefined): CompactTab | null {
  if (!t) return null;
  const out: CompactTab = {};
  if (t.threads != null) out.t = t.threads;
  if (t.posts != null) out.p = t.posts;
  return Object.keys(out).length ? out : null;
}

function toCompact(name: string, doc: EditionStats): CompactRow | null {
  const e =
    typeof doc.edition === "number" ? doc.edition : Number.parseFloat(name);
  if (!Number.isFinite(e)) return null;
  const out: CompactRow = { e };

  const site = doc.site_statistics ?? {};
  if (site.total_posts != null) out.tp = site.total_posts;
  if (site.total_threads != null) out.tt = site.total_threads;
  if (site.total_members != null) out.tm = site.total_members;
  if (site.daily_posts != null) out.dp = site.daily_posts;
  if (site.daily_threads != null) out.dt = site.daily_threads;
  if (site.daily_new_members != null) out.dm = site.daily_new_members;

  const lw = doc.ban_statistics?.last_week ?? {};
  if (lw.staff_bans != null) out.bs = lw.staff_bans;
  if (lw.vacation_bans != null) out.bv = lw.vacation_bans;
  if (lw.combined_bans != null) out.bc = lw.combined_bans;

  const tot = doc.ban_statistics?.total ?? {};
  if (tot.staff_bans != null) out.bts = tot.staff_bans;
  if (tot.vacation_bans != null) out.btv = tot.vacation_bans;
  if (tot.combined_bans != null) out.btc = tot.combined_bans;

  const lounge = doc.forum_counts?.notable_sections?.lounge;
  const ranf = doc.forum_counts?.notable_sections?.ranf;
  if (lounge?.threads != null) out.lt = lounge.threads;
  if (lounge?.posts != null) out.lp = lounge.posts;
  if (ranf?.threads != null) out.rt = ranf.threads;
  if (ranf?.posts != null) out.rp = ranf.posts;

  const tabs = doc.forum_counts?.tabs;
  if (tabs && Object.keys(tabs).length) {
    const compactTabs: Record<string, CompactTab> = {};
    for (const [key, val] of Object.entries(tabs)) {
      const c = compactTab(val);
      if (c) compactTabs[key] = c;
    }
    if (Object.keys(compactTabs).length) out.tab = compactTabs;
  }

  // Edition has no payload beyond `e`? Skip it.
  if (Object.keys(out).length === 1) return null;
  return out;
}

async function main() {
  const entries = await readdir(editionsDir, { withFileTypes: true });
  const dirs = entries
    .filter((e) => e.isDirectory() && editionDir.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => Number.parseFloat(a) - Number.parseFloat(b));

  const rows: CompactRow[] = [];
  for (const name of dirs) {
    const statsPath = join(editionsDir, name, "stats.json");
    let raw: string;
    try {
      raw = await readFile(statsPath, "utf8");
    } catch {
      continue;
    }
    let doc: EditionStats;
    try {
      doc = JSON.parse(raw) as EditionStats;
    } catch (err) {
      console.warn(`Skip ${name}: invalid JSON (${(err as Error).message})`);
      continue;
    }
    const compact = toCompact(name, doc);
    if (compact) rows.push(compact);
  }

  const payload = { n: rows.length, s: rows };
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(payload), "utf8");
  const bytes = (await readFile(outFile)).byteLength;
  console.log(`Wrote ${outFile} (${rows.length} editions, ${bytes} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
