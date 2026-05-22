// Read-only scanner: assess which HF News editions contain Site Statistics,
// Ban Statistics, and Forum Counts sections. Writes a markdown summary to
// STATS_COVERAGE.md at the repo root and also prints the per-edition
// classification to stdout for piping.
//
// Run:  node scripts/detect_stats_coverage.js

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const editionsDir = path.join(ROOT, "editions");

/** Load every edition's source text (concatenated across all posts, or the
 *  blog message). Returns { id, num, source, text } per edition. */
function loadEditions() {
  const out = [];
  const entries = fs.readdirSync(editionsDir, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (!/^\d+(?:\.\d+)?$/.test(e.name)) continue;
    const num = parseFloat(e.name);
    const dir = path.join(editionsDir, e.name);
    const postsP = path.join(dir, "posts.json");
    const blogsP = path.join(dir, "blogs.json");
    let text = null;
    let source = null;
    if (fs.existsSync(postsP)) {
      try {
        const d = JSON.parse(fs.readFileSync(postsP, "utf8"));
        text = (d.posts || []).map((p) => p.message || "").join("\n");
        source = "posts";
      } catch {}
    } else if (fs.existsSync(blogsP)) {
      try {
        const d = JSON.parse(fs.readFileSync(blogsP, "utf8"));
        text = d.message || "";
        source = "blog";
      } catch {}
    }
    if (text == null) continue;
    out.push({ id: e.name, num, source, text });
  }
  out.sort((a, b) => a.num - b.num);
  return out;
}

/** Section detectors. Each returns true iff the heading text AND at least one
 *  of the expected sub-labels appear within a reasonable window of each other.
 *  Window-based check avoids matching prose mentions of "site statistics" in
 *  unrelated announcements. */
function hasSection(text, heading, subLabels, windowChars = 1200) {
  const re = new RegExp(heading.replace(/\s+/g, "\\s+"), "i");
  const m = re.exec(text);
  if (!m) return false;
  const window = text.substring(m.index, m.index + windowChars);
  for (const sub of subLabels) {
    if (window.includes(sub)) return true;
  }
  return false;
}

function detectSite(text) {
  // "Site Statistics" or "Site Stats" — both spellings seen in the archive.
  return (
    hasSection(text, "Site Statistics", ["Posts:", "Threads:", "Members:"]) ||
    hasSection(text, "Site Stats", ["Posts:", "Threads:", "Members:"])
  );
}

function detectBan(text) {
  return hasSection(text, "Ban Statistics", [
    "Staff Bans",
    "Vacation Bans",
    "Combined Bans",
  ]);
}

function detectForum(text) {
  return hasSection(
    text,
    "Forum Counts",
    ["Lounge", "RANF", "Hacking", "forumdisplay.php"],
    2000,
  );
}

function classify(ed) {
  return {
    id: ed.id,
    num: ed.num,
    source: ed.source,
    site: detectSite(ed.text),
    ban: detectBan(ed.text),
    forum: detectForum(ed.text),
  };
}

// ------- canonical-edition cross-reference (editions.csv) -------
function loadCanonicalEditions() {
  const csvPath = path.join(ROOT, "editions.csv");
  const set = new Set();
  if (!fs.existsSync(csvPath)) return set;
  const txt = fs.readFileSync(csvPath, "utf8");
  // Header: Extracted,Edition,Link,Name,Note
  const lines = txt.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < 2) continue;
    const ed = cols[1].trim();
    if (ed) set.add(ed);
  }
  return set;
}

// ------- range / gap helpers -------
function findContiguousRanges(predicateNums) {
  // predicateNums: array of edition numbers (integers) where the predicate is true, sorted ascending
  const ranges = [];
  let runStart = null;
  let prev = null;
  for (const n of predicateNums) {
    if (runStart === null) {
      runStart = n;
      prev = n;
    } else if (n === prev + 1) {
      prev = n;
    } else {
      ranges.push([runStart, prev]);
      runStart = n;
      prev = n;
    }
  }
  if (runStart !== null) ranges.push([runStart, prev]);
  return ranges;
}

function findGaps(predicateNums, lowerBound, upperBound) {
  // Editions in [lowerBound, upperBound] that are NOT in predicateNums
  const set = new Set(predicateNums);
  const gaps = [];
  for (let n = lowerBound; n <= upperBound; n++) {
    if (!set.has(n)) gaps.push(n);
  }
  return gaps;
}

// ------- main -------
const editions = loadEditions();
const canonical = loadCanonicalEditions();
const results = editions.map(classify);

// Per-edition stdout (terse, pipeable)
for (const r of results) {
  process.stdout.write(
    `${r.id}\tsite=${r.site ? 1 : 0}\tban=${r.ban ? 1 : 0}\tforum=${r.forum ? 1 : 0}\tsource=${r.source}\n`,
  );
}

// ------- summary stats -------
const total = results.length;
const siteEds = results.filter((r) => r.site);
const banEds = results.filter((r) => r.ban);
const forumEds = results.filter((r) => r.forum);
const allThree = results.filter((r) => r.site && r.ban && r.forum);
const none = results.filter((r) => !r.site && !r.ban && !r.forum);

// Integer-only edition numbers for range/gap math (sub-numbered editions
// like 8.1 are recorded but excluded from contiguous-range analysis).
const intNumsWithSite = siteEds
  .map((r) => r.num)
  .filter((n) => Number.isInteger(n))
  .sort((a, b) => a - b);
const intNumsAll3 = allThree
  .map((r) => r.num)
  .filter((n) => Number.isInteger(n))
  .sort((a, b) => a - b);

const earliest = (rs) => rs.length ? Math.min(...rs.map((r) => r.num)) : null;
const latest = (rs) => rs.length ? Math.max(...rs.map((r) => r.num)) : null;

const earliestSite = earliest(siteEds);
const latestSite = latest(siteEds);
const earliestAll3 = earliest(allThree);
const latestAll3 = latest(allThree);

const allRanges = findContiguousRanges(intNumsAll3);
// Gaps inside the "all three" envelope
const gapsInAll3Range =
  earliestAll3 != null
    ? findGaps(intNumsAll3, Math.ceil(earliestAll3), Math.floor(latestAll3))
    : [];

// Missing from archive: canonical editions not present here
const archivedIds = new Set(editions.map((e) => e.id));
const missingFromArchive = [...canonical].filter((id) => !archivedIds.has(id));

// ------- write STATS_COVERAGE.md -------
const reportPath = path.join(ROOT, "STATS_COVERAGE.md");

function summarizeNumberList(nums) {
  if (nums.length === 0) return "(none)";
  const ranges = findContiguousRanges(nums);
  return ranges
    .map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`))
    .join(", ");
}

const md = `# Stats Coverage Across HF News Editions

Generated by \`scripts/detect_stats_coverage.js\`. Re-run after adding or
editing source data:

\`\`\`bash
node scripts/detect_stats_coverage.js
\`\`\`

## Headline numbers

- **Total editions scanned**: ${total}
- **Site Statistics** present: ${siteEds.length} (${((siteEds.length / total) * 100).toFixed(1)}%)
- **Ban Statistics** present: ${banEds.length} (${((banEds.length / total) * 100).toFixed(1)}%)
- **Forum Counts** present: ${forumEds.length} (${((forumEds.length / total) * 100).toFixed(1)}%)
- **All three** sections together: ${allThree.length} (${((allThree.length / total) * 100).toFixed(1)}%)
- **None of the three** sections: ${none.length} (${((none.length / total) * 100).toFixed(1)}%)

## Earliest and latest

- Site Statistics: editions **${earliestSite ?? "—"} → ${latestSite ?? "—"}**
- All three together: editions **${earliestAll3 ?? "—"} → ${latestAll3 ?? "—"}**

## Contiguous ranges with all three sections

${allRanges.length
    ? allRanges
        .map(([a, b]) => (a === b ? `- ${a}` : `- ${a}–${b} (${b - a + 1} editions)`))
        .join("\n")
    : "(no contiguous ranges)"}

## Gaps inside the "all three" envelope

Editions inside ${earliestAll3 ?? "?"}–${latestAll3 ?? "?"} that are missing
at least one of the three stats sections:

${gapsInAll3Range.length ? summarizeNumberList(gapsInAll3Range) : "(no gaps — full coverage)"}

## Per-section coverage at a glance

| Section | Count | Range |
|---|---|---|
| Site Statistics | ${siteEds.length} | ${earliest(siteEds) ?? "—"} → ${latest(siteEds) ?? "—"} |
| Ban Statistics | ${banEds.length} | ${earliest(banEds) ?? "—"} → ${latest(banEds) ?? "—"} |
| Forum Counts | ${forumEds.length} | ${earliest(forumEds) ?? "—"} → ${latest(forumEds) ?? "—"} |

## Source-file split

| Source | Editions scanned | With any stats |
|---|---|---|
| posts.json | ${results.filter((r) => r.source === "posts").length} | ${results.filter((r) => r.source === "posts" && (r.site || r.ban || r.forum)).length} |
| blogs.json | ${results.filter((r) => r.source === "blog").length} | ${results.filter((r) => r.source === "blog" && (r.site || r.ban || r.forum)).length} |

Editions 442–508 use \`blogs.json\` (a platform-style change) and the
formatted stats sections are mostly absent there.

## Missing from archive

${missingFromArchive.length
    ? `Canonical editions in \`editions.csv\` not present in \`editions/\`: ${missingFromArchive.length} entries. First 20: ${missingFromArchive.slice(0, 20).join(", ")}${missingFromArchive.length > 20 ? "…" : ""}`
    : "All canonical editions are archived."}

## Detection patterns (for future re-runs)

The script uses lenient substring matching with a windowed sub-label check
to avoid false positives on prose mentions:

| Section | Heading | Required sub-label (any of) | Window |
|---|---|---|---|
| Site Statistics | \`Site Statistics\` or \`Site Stats\` | \`Posts:\`, \`Threads:\`, \`Members:\` | 1200 chars |
| Ban Statistics | \`Ban Statistics\` | \`Staff Bans\`, \`Vacation Bans\`, \`Combined Bans\` | 1200 chars |
| Forum Counts | \`Forum Counts\` | \`Lounge\`, \`RANF\`, \`Hacking\`, \`forumdisplay.php\` | 2000 chars |

The scan covers **all posts** of each post-based edition (not just the
opening post) and the single \`message\` field of each blog-based edition.
`;

fs.writeFileSync(reportPath, md);
process.stderr.write(`\nWrote ${reportPath}\n`);
