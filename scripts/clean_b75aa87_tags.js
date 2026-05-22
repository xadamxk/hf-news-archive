// Clean up tags applied by commit b75aa87 (the keyword-based auto-tag pass).
// Identifies events that were newly tagged in that commit (by matching title
// inside each edition's events.json), then applies the rules below to those
// events in the CURRENT working-tree events.json — preserving any later
// hand-curation of other events untouched.
//
// Rules (applied only when the event was first tagged by b75aa87):
//   - If category !== "site": drop tags `infrastructure`, `awards`,
//     `features`, `bug-fixes`, `theme`.
//   - If category === "groups": drop tag `rules`.
//
// Usage: node scripts/clean_b75aa87_tags.js [--dry]

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const COMMIT = "b75aa87";
const DRY = process.argv.includes("--dry");

const NON_SITE_DROP = new Set(["infrastructure", "awards", "features", "bug-fixes", "theme"]);
const GROUPS_DROP = new Set(["rules"]);

function gitShow(rev, file) {
  try {
    return execFileSync("git", ["show", `${rev}:${file}`], { cwd: ROOT, encoding: "utf8" });
  } catch {
    return null;
  }
}

/** Files touched by the commit, restricted to editions/<N>/events.json. */
const filesRaw = execFileSync(
  "git",
  ["diff-tree", "--no-commit-id", "--name-only", "-r", COMMIT],
  { cwd: ROOT, encoding: "utf8" },
);
const editionFiles = filesRaw
  .split(/\r?\n/)
  .filter((f) => /^editions\/[^/]+\/events\.json$/.test(f));

console.log(`Scanning ${editionFiles.length} edition files modified by ${COMMIT}.`);

let editionsTouched = 0;
let eventsScanned = 0;
let eventsCleaned = 0;
const tagDropCounts = new Map();

for (const file of editionFiles) {
  const beforeRaw = gitShow(`${COMMIT}^`, file);
  const afterRaw = gitShow(COMMIT, file);
  if (!beforeRaw || !afterRaw) continue;
  let before, after;
  try { before = JSON.parse(beforeRaw); after = JSON.parse(afterRaw); } catch { continue; }
  if (!Array.isArray(before.events) || !Array.isArray(after.events)) continue;

  // Map title → tags at each commit state. If the same title appears more than
  // once in an edition we conservatively skip the dup-title group so we don't
  // mis-tag the wrong instance.
  function titleMap(events) {
    const m = new Map();
    for (const ev of events) {
      const t = ev.title;
      if (t == null) continue;
      const prev = m.get(t);
      if (prev === undefined) m.set(t, ev);
      else m.set(t, "__dup__");
    }
    return m;
  }
  const beforeByTitle = titleMap(before.events);
  const afterByTitle = titleMap(after.events);

  const currentPath = path.join(ROOT, file);
  if (!fs.existsSync(currentPath)) continue;
  const currentRaw = fs.readFileSync(currentPath, "utf8");
  const current = JSON.parse(currentRaw);
  if (!Array.isArray(current.events)) continue;

  let changed = false;
  for (const ev of current.events) {
    eventsScanned++;
    if (!Array.isArray(ev.tags) || ev.tags.length === 0) continue;
    const title = ev.title;
    const bEv = beforeByTitle.get(title);
    const aEv = afterByTitle.get(title);
    if (!bEv || bEv === "__dup__" || !aEv || aEv === "__dup__") continue;
    // Was the event tagged by b75aa87? Before: no tags or empty. After: had tags.
    const beforeHadTags = Array.isArray(bEv.tags) && bEv.tags.length > 0;
    const afterHasTags = Array.isArray(aEv.tags) && aEv.tags.length > 0;
    if (beforeHadTags) continue;
    if (!afterHasTags) continue;

    const cat = ev.category;
    const before2 = [...ev.tags];
    const kept = ev.tags.filter((t) => {
      if (cat !== "site" && NON_SITE_DROP.has(t)) return false;
      if (cat === "groups" && GROUPS_DROP.has(t)) return false;
      return true;
    });
    if (kept.length === before2.length) continue;

    for (const t of before2) {
      if (!kept.includes(t)) {
        tagDropCounts.set(t, (tagDropCounts.get(t) || 0) + 1);
      }
    }
    if (kept.length === 0) delete ev.tags;
    else ev.tags = kept;
    changed = true;
    eventsCleaned++;
  }

  if (changed && !DRY) {
    const line3 = currentRaw.split("\n")[2] || "";
    const indent = /^\s{8}/.test(line3) ? 4 : 2;
    fs.writeFileSync(currentPath, JSON.stringify(current, null, indent) + "\n");
  }
  if (changed) editionsTouched++;
}

console.log(`\nEvents scanned: ${eventsScanned}`);
console.log(`Events cleaned: ${eventsCleaned}`);
console.log(`Editions touched: ${editionsTouched}`);
console.log("Tag-removal breakdown:");
[...tagDropCounts.entries()].sort((a, b) => b[1] - a[1]).forEach(([t, n]) => console.log(`  ${t}: ${n}`));
if (DRY) console.log("\n(dry run — no files written)");
