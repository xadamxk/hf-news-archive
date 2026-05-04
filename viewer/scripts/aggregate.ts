/**
 * Aggregates each editions/<name>/events.json into viewer/public/events.json
 * Compact schema (short keys) for smaller static payload.
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
type RawEvent = {
  category: string;
  title: string;
  description?: string;
  url?: string;
  users?: RawUser[];
  date: number;
  edition: number;
};

type CompactUser = { i: string; n: string; r?: string };
type CompactEvent = {
  c: string;
  t: string;
  d?: string;
  l?: string;
  u?: CompactUser[];
  e: number;
  s: number;
};

function compactEvent(ev: RawEvent): CompactEvent {
  const out: CompactEvent = {
    c: ev.category,
    t: ev.title,
    e: typeof ev.edition === "number" ? ev.edition : Number(ev.edition),
    s: typeof ev.date === "number" ? ev.date : Number(ev.date),
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
    let data: { events?: RawEvent[] };
    try {
      data = JSON.parse(raw) as { events?: RawEvent[] };
    } catch (e) {
      console.warn(`Skip ${d.name}: invalid JSON`, e);
      continue;
    }
    const events = data.events;
    if (!Array.isArray(events)) continue;
    for (const ev of events) {
      if (!ev || typeof ev !== "object") continue;
      if (!ev.category || ev.title == null || ev.date == null || ev.edition == null) {
        console.warn(`Skip incomplete event in ${d.name}`);
        continue;
      }
      items.push(compactEvent(ev as RawEvent));
    }
  }

  items.sort((a, b) => b.s - a.s || Number(b.e) - Number(a.e));

  const payload = { v: 1, n: items.length, a: items };
  const min = JSON.stringify(payload);
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, min, "utf8");
  console.log(`Wrote ${outFile} (${items.length} events, ${min.length} bytes)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
