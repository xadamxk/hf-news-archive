/**
 * Aggregates each editions/<name>/events.json into viewer/public/events.json
 * Compact schema (short keys) for smaller static payload.
 * v2: edition rows in `ed`, events reference index via `x`.
 *
 * Run from repo root: bun run viewer/scripts/aggregate.ts
 * Or from viewer/: bun run scripts/aggregate.ts
 */
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const viewerRoot = join(__dirname, "..");
const repoRoot = join(viewerRoot, "..");
const editionsDir = join(repoRoot, "editions");
const outFile = join(viewerRoot, "public", "events.json");

const editionDir = /^\d+(?:\.\d+)?$/;

type RawUser = { uid?: string; username?: string; role?: string };
type RawEditionMeta = {
  number: unknown;
  date: unknown;
  pid: unknown;
  author_uid: unknown;
  subject: unknown;
};
type RawEvent = {
  category: string;
  title: string;
  description?: string;
  url?: string;
  users?: RawUser[];
};

type CompactUser = { i: string; n: string; r?: string };
type CompactEditionRow = {
  e: number;
  s: number;
  p: string;
  a: string;
  h: string;
};
type CompactEvent = {
  c: string;
  t: string;
  d?: string;
  l?: string;
  u?: CompactUser[];
  x: number;
};

function num(x: unknown): number | null {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string" && x.trim() !== "") {
    const n = Number(x);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function str(x: unknown): string {
  if (x == null) return "";
  return String(x).trim();
}

function validateEdition(meta: unknown, folder: string): CompactEditionRow | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    console.warn(`Skip ${folder}: missing edition object`);
    return null;
  }
  const m = meta as RawEditionMeta;
  const e = num(m.number);
  const s = num(m.date);
  if (e == null || s == null) {
    console.warn(`Skip ${folder}: edition.number / edition.date invalid`);
    return null;
  }
  return {
    e,
    s,
    p: str(m.pid),
    a: str(m.author_uid),
    h: typeof m.subject === "string" ? m.subject : str(m.subject),
  };
}

function compactEvent(ev: RawEvent, editionIdx: number): CompactEvent {
  const out: CompactEvent = {
    c: ev.category,
    t: ev.title,
    x: editionIdx,
  };
  const desc = ev.description?.trim();
  if (desc) out.d = desc;
  const url = ev.url?.trim();
  if (url) out.l = url;
  const users = ev.users?.filter((u) => u && (u.uid || u.username));
  if (users?.length) {
    out.u = users.map((u) => {
      const row: CompactUser = {
        i: String(u.uid ?? ""),
        n: String(u.username ?? ""),
      };
      const r = u.role?.trim();
      if (r) row.r = r;
      return row;
    });
  }
  return out;
}

async function main() {
  const dirents = await readdir(editionsDir, { withFileTypes: true });
  const editions: CompactEditionRow[] = [];
  const items: CompactEvent[] = [];

  for (const d of dirents) {
    if (!d.isDirectory() || !editionDir.test(d.name)) continue;
    const path = join(editionsDir, d.name, "events.json");
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      continue;
    }
    let data: { edition?: unknown; events?: RawEvent[] };
    try {
      data = JSON.parse(raw) as { edition?: unknown; events?: RawEvent[] };
    } catch (e) {
      console.warn(`Skip ${d.name}: invalid JSON`, e);
      continue;
    }
    const row = validateEdition(data.edition, d.name);
    if (!row) continue;

    const events = data.events;
    if (!Array.isArray(events)) continue;

    const editionIdx = editions.length;
    editions.push(row);

    for (const ev of events) {
      if (!ev || typeof ev !== "object") continue;
      if (!ev.category || ev.title == null) {
        console.warn(`Skip incomplete event in ${d.name}`);
        continue;
      }
      items.push(compactEvent(ev as RawEvent, editionIdx));
    }
  }

  items.sort((a, b) => {
    const eb = editions[b.x];
    const ea = editions[a.x];
    if (!ea || !eb) return 0;
    const cmpS = eb.s - ea.s;
    if (cmpS !== 0) return cmpS;
    return eb.e - ea.e;
  });

  const payload = { v: 2, ed: editions, n: items.length, a: items };
  const min = JSON.stringify(payload);
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, min, "utf8");
  console.log(
    `Wrote ${outFile} (${items.length} events, ${editions.length} editions, ${min.length} bytes)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
