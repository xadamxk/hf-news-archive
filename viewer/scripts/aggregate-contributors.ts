/**
 * Aggregates per-contributor stats across every editions/<n>/events.json into
 * viewer/public/contributors.json (minified).
 *
 * Counts each user (by UID, never by username) once per edition they appear
 * in inside any "Contributors to ..." news event. Tracks the latest username
 * seen (most recent edition wins) and the most-recent role string.
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
 *         "r": "<role>",        // r = role      — most-recent role string (omitted if empty)
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
  role: string;
  editions: Set<number>;
  firstEdition: number;
  lastEdition: number;
  lastSeen: number; // numeric edition for "latest" comparisons
};

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
            role,
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
        // Most-recent edition wins for username/role
        if (editionNum >= a.lastSeen) {
          a.lastSeen = editionNum;
          a.username = username;
          if (role) a.role = role;
        }
      }
    }
  }

  const rows = [...agg.values()]
    .map((a) => ({
      i: a.uid,
      u: a.username,
      e: a.editions.size,
      r: a.role || undefined,
      f: a.firstEdition,
      l: a.lastEdition,
    }))
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
