// Audit every `users[]` entry across editions/<N>/events.json for uid issues.
// Categories:
//   A) uid property missing entirely
//   B) uid present but empty string
//   C) uid present but not a numeric string (e.g. "X", "unknown")
// Writes AUDIT_USER_UIDS.md.

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const EDITIONS_DIR = path.join(ROOT, "editions");
const OUTPUT = path.join(ROOT, "AUDIT_USER_UIDS.md");

const missingProp = [];
const emptyUid = [];
const nonNumeric = [];

const dirs = fs.readdirSync(EDITIONS_DIR).sort((a, b) => {
  const na = Number.parseFloat(a);
  const nb = Number.parseFloat(b);
  return Number.isFinite(na) && Number.isFinite(nb) ? na - nb : a.localeCompare(b);
});

for (const ed of dirs) {
  const p = path.join(EDITIONS_DIR, ed, "events.json");
  if (!fs.existsSync(p)) continue;
  let doc;
  try { doc = JSON.parse(fs.readFileSync(p, "utf8")); } catch { continue; }
  if (!Array.isArray(doc.events)) continue;
  doc.events.forEach((ev, idx) => {
    if (!Array.isArray(ev.users)) return;
    ev.users.forEach((u, ui) => {
      const row = {
        ed,
        event_idx: idx,
        user_idx: ui,
        category: ev.category || "",
        title: ev.title || "",
        username: u.username || "(no username)",
        uid: u.uid,
      };
      if (!("uid" in u)) {
        missingProp.push(row);
        return;
      }
      const v = u.uid;
      if (v === "" || v === null || v === undefined) {
        emptyUid.push(row);
        return;
      }
      const s = String(v).trim();
      if (s === "" || !/^\d+$/.test(s)) {
        nonNumeric.push(row);
      }
    });
  });
}

function table(rows) {
  if (!rows.length) return "_(none)_\n";
  const out = [];
  out.push("| Edition | Event idx | User idx | Category | Username | uid | Event title |");
  out.push("|---|---|---|---|---|---|---|");
  for (const r of rows) {
    const title = r.title.replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 80);
    const uname = String(r.username).replace(/\|/g, "\\|");
    const uid = r.uid === undefined ? "(absent)" : JSON.stringify(r.uid);
    out.push(`| ${r.ed} | ${r.event_idx} | ${r.user_idx} | ${r.category} | ${uname} | \`${uid}\` | ${title} |`);
  }
  return out.join("\n") + "\n";
}

const md = [
  "# User UID Audit",
  "",
  `Scanned every \`users[]\` entry across \`editions/<N>/events.json\` for uid integrity.`,
  "",
  `- **Missing uid property**: ${missingProp.length}`,
  `- **Empty uid (\"\", null, undefined)**: ${emptyUid.length}`,
  `- **Non-numeric uid value**: ${nonNumeric.length}`,
  "",
  "## A. Missing `uid` property",
  "",
  table(missingProp),
  "## B. Empty `uid` value",
  "",
  table(emptyUid),
  "## C. Non-numeric `uid` value",
  "",
  table(nonNumeric),
].join("\n");

fs.writeFileSync(OUTPUT, md);
console.log(`Wrote ${path.relative(ROOT, OUTPUT)}`);
console.log(`  Missing uid property: ${missingProp.length}`);
console.log(`  Empty uid:            ${emptyUid.length}`);
console.log(`  Non-numeric uid:      ${nonNumeric.length}`);
