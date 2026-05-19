/**
 * Aggregates per-contributor stats across every editions/<n>/events.json into
 * viewer/public/contributors.json (minified).
 *
 * Counts each user (by UID, never by username) once per edition they appear
 * in inside any "Contributors to ..." news event. Tracks the latest username
 * seen (most recent edition wins) and the full set of distinct role atoms
 * the user has ever held (e.g. "Headlines", "Interviewer", "Publisher").
 *
 * Role atoms are extracted by:
 *   - Splitting the role string at top-level " / " (respecting parens)
 *   - Unwrapping any "Journalist (X / Y)" wrapper to its inner pieces
 *   - Dropping the literal "Journalist" sentinel (kept only as the wrapper)
 *
 * Output schema (compact, minified) — short keys to shrink the payload:
 *
 *   {
 *     "n": <number>,            // n = total number of unique contributors (uids)
 *     "c": [                    // c = contributors array, one row per uid
 *       {
 *         "i": "<uid>",         // i = id        — Hack Forums user id (string)
 *         "u": "<username>",    // u = username  — most-recent name seen for this uid
 *         "e": <number>,        // e = editions  — count of distinct editions contributed to
 *         "r": ["<atom>", ...], // r = roles     — every distinct role atom ever held
 *                               //                  (sorted alphabetically; omitted if empty)
 *         "f": <number>,        // f = first     — earliest edition number this uid appeared in
 *         "l": <number>         // l = last      — latest edition number this uid appeared in
 *       },
 *       ...
 *     ]
 *   }
 *
 * Sorted by edition count descending, then by latest edition descending.
 *
 * Run from repo root:  bun run viewer/scripts/aggregate-contributors.ts
 * Or from viewer/:     bun run scripts/aggregate-contributors.ts
 */
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const viewerRoot = join(__dirname, "..");
const repoRoot = join(viewerRoot, "..");
const editionsDir = join(repoRoot, "editions");
const outFile = join(viewerRoot, "public", "contributors.json");

const editionDir = /^\d+(?:\.\d+)?$/;

type RawUser = { uid?: string; username?: string; role?: string };
type RawEvent = { category: string; title: string; users?: RawUser[] };
type RawEditionMeta = { number?: unknown };
type RawEditionFile = { events?: RawEvent[]; edition?: RawEditionMeta };

type Agg = {
  uid: string;
  username: string;
  roleAtoms: Set<string>;
  editions: Set<number>;
  firstEdition: number;
  lastEdition: number;
  lastSeen: number; // numeric edition for "latest username" comparisons
};

/** Split a role string at top-level " / " separators, respecting parens. */
function splitTopLevel(s: string, sep = " / "): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (depth === 0 && s.substring(i, i + sep.length) === sep) {
      out.push(s.substring(start, i));
      start = i + sep.length;
      i += sep.length - 1;
    }
  }
  out.push(s.substring(start));
  return out.map((x) => x.trim()).filter(Boolean);
}

/** Split at top-level ", " too. A handful of legacy role strings used a comma
 *  as the separator (e.g. "3rd Compiler, 4th Compiler", "User News, Next Week").
 *  Splitting on ", " unifies those with the " / " convention so atoms dedupe. */
function splitAtoms(s: string): string[] {
  return splitTopLevel(s).flatMap((piece) => splitTopLevel(piece, ", "));
}

/** Turn one atom into its constituent role-pieces, dropping the
 *  literal "Journalist" wrapper-sentinel. */
function unwrapJournalist(atom: string): string[] {
  if (atom.trim() === "Journalist") return [];
  const m = atom.match(/^Journalist\s*\((.*)\)$/);
  if (m) return splitAtoms(m[1]);
  return [atom];
}

/** Temporal qualifiers that appeared as standalone atoms only because some
 *  legacy role strings used a comma separator (e.g. "User News, Next Week").
 *  They're not real roles, so drop them after splitting. */
const TEMPORAL_QUALIFIERS = new Set(["next week", "this week", "last week"]);

/** Strip leading ordinal prefixes like "2nd ", "3rd Scholar" → "Scholar". The
 *  ordinal-position rarely matters for the contributor table; the underlying
 *  role is what counts. */
function stripOrdinal(atom: string): string {
  return atom.replace(/^\d+(?:st|nd|rd|th)\s+/i, "").trim();
}

/** Extract the flat set of role atoms from a role string. */
function roleAtoms(role: string): string[] {
  if (!role) return [];
  return splitAtoms(role)
    .flatMap(unwrapJournalist)
    .map(stripOrdinal)
    .filter((a) => a && !TEMPORAL_QUALIFIERS.has(a.toLowerCase()));
}

async function main() {
  const entries = await readdir(editionsDir, { withFileTypes: true });
  const dirs = entries
    .filter((e) => e.isDirectory() && editionDir.test(e.name))
    .map((e) => e.name);

  const agg = new Map<string, Agg>();

  for (const name of dirs) {
    const path = join(editionsDir, name, "events.json");
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      continue;
    }
    let data: RawEditionFile;
    try {
      data = JSON.parse(raw) as RawEditionFile;
    } catch {
      continue;
    }
    const editionNum =
      typeof data.edition?.number === "number"
        ? data.edition.number
        : Number.parseFloat(name);
    if (!Number.isFinite(editionNum)) continue;

    for (const ev of data.events ?? []) {
      if (ev.category !== "news") continue;
      if (!/^Contributors to /i.test(ev.title ?? "")) continue;
      for (const u of ev.users ?? []) {
        if (!u?.uid) continue;
        const uid = String(u.uid);
        const username = u.username ?? `uid${uid}`;
        const role = u.role ?? "";
        let a = agg.get(uid);
        if (!a) {
          a = {
            uid,
            username,
            roleAtoms: new Set(),
            editions: new Set(),
            firstEdition: editionNum,
            lastEdition: editionNum,
            lastSeen: editionNum,
          };
          agg.set(uid, a);
        }
        a.editions.add(editionNum);
        if (editionNum < a.firstEdition) a.firstEdition = editionNum;
        if (editionNum > a.lastEdition) a.lastEdition = editionNum;
        if (editionNum >= a.lastSeen) {
          a.lastSeen = editionNum;
          a.username = username;
        }
        for (const atom of roleAtoms(role)) a.roleAtoms.add(atom);
      }
    }
  }

  const rows = [...agg.values()]
    .map((a) => {
      const roles = [...a.roleAtoms].sort((x, y) =>
        x.localeCompare(y, undefined, { sensitivity: "base" }),
      );
      // Fallback: a contributor with no extracted atoms (e.g. their only
      // recorded role was the bare "Journalist" sentinel) still needs a
      // displayable role. Default to "Journalist".
      if (roles.length === 0) roles.push("Journalist");
      return {
        i: a.uid,
        u: a.username,
        e: a.editions.size,
        r: roles,
        f: a.firstEdition,
        l: a.lastEdition,
      };
    })
    .sort((x, y) => (y.e - x.e) || (y.l - x.l));

  const payload = { n: rows.length, c: rows };
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(payload), "utf8");
  console.log(
    `Wrote ${outFile} (${rows.length} contributors, ${
      (await readFile(outFile)).byteLength
    } bytes)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
