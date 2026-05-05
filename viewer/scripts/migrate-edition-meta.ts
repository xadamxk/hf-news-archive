/**
 * One-time (or idempotent): move per-event date/edition into root `edition` object
 * with number, date, pid, author_uid, subject from posts.json first post when available.
 *
 * Run from repo root: bun run viewer/scripts/migrate-edition-meta.ts
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const viewerRoot = join(__dirname, "..");
const repoRoot = join(viewerRoot, "..");
const editionsDir = join(repoRoot, "editions");
const editionDir = /^\d+(?:\.\d+)?$/;

type EditionMeta = {
  number: number;
  date: number;
  pid: string;
  author_uid: string;
  subject: string;
};

type LegacyEvent = Record<string, unknown>;

function folderEditionNumber(folder: string): number {
  const n = Number.parseFloat(folder);
  return Number.isFinite(n) ? n : NaN;
}

function isMigrated(data: Record<string, unknown>, events: LegacyEvent[]): boolean {
  const ed = data.edition;
  if (!ed || typeof ed !== "object" || Array.isArray(ed)) return false;
  const o = ed as Record<string, unknown>;
  const keys = ["number", "date", "pid", "author_uid", "subject"] as const;
  if (!keys.every((k) => k in o)) return false;
  for (const ev of events) {
    if (!ev || typeof ev !== "object") continue;
    if ("date" in ev || "edition" in ev) return false;
  }
  return true;
}

function stripEventMeta(ev: LegacyEvent): void {
  delete ev.date;
  delete ev.edition;
}

async function main() {
  const dirents = await readdir(editionsDir, { withFileTypes: true });
  let migrated = 0;
  let skipped = 0;
  const warnings: string[] = [];

  for (const d of dirents) {
    if (!d.isDirectory() || !editionDir.test(d.name)) continue;
    const folder = d.name;
    const evPath = join(editionsDir, folder, "events.json");
    const postsPath = join(editionsDir, folder, "posts.json");
    let raw: string;
    try {
      raw = await readFile(evPath, "utf8");
    } catch {
      continue;
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch (e) {
      warnings.push(`${folder}: invalid JSON (${e})`);
      continue;
    }

    const events = data.events;
    if (!Array.isArray(events)) {
      warnings.push(`${folder}: missing events array`);
      continue;
    }

    const eventObjs = events.filter((x): x is LegacyEvent => x && typeof x === "object");

    if (isMigrated(data, eventObjs)) {
      skipped++;
      continue;
    }

    const edExisting = data.edition;
    if (edExisting && typeof edExisting === "object" && !Array.isArray(edExisting)) {
      const o = edExisting as Record<string, unknown>;
      const keys = ["number", "date", "pid", "author_uid", "subject"] as const;
      if (keys.every((k) => k in o)) {
        let needsStrip = false;
        for (const ev of eventObjs) {
          if ("date" in ev || "edition" in ev) needsStrip = true;
        }
        if (needsStrip) {
          for (const ev of eventObjs) stripEventMeta(ev);
          await writeFile(evPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
          migrated++;
        } else skipped++;
        continue;
      }
    }

    const folderNum = folderEditionNumber(folder);
    let dateFallback: number | undefined;
    let editionFallback: number | undefined;
    for (const ev of eventObjs) {
      if (typeof ev.date === "number" && Number.isFinite(ev.date)) {
        dateFallback = ev.date;
        break;
      }
      if (ev.date != null && String(ev.date).trim() !== "") {
        const n = Number(ev.date);
        if (Number.isFinite(n)) dateFallback = n;
        break;
      }
    }
    for (const ev of eventObjs) {
      if (ev.edition != null) {
        const n = typeof ev.edition === "number" ? ev.edition : Number(ev.edition);
        if (Number.isFinite(n)) {
          editionFallback = n;
          break;
        }
      }
    }

    let pid = "";
    let author_uid = "";
    let subject = "";
    let dateFromPost: number | undefined;

    try {
      const postsRaw = await readFile(postsPath, "utf8");
      const postsData = JSON.parse(postsRaw) as {
        posts?: { pid?: string; uid?: string; subject?: string; dateline?: string | number }[];
      };
      const first = postsData.posts?.[0];
      if (first) {
        if (first.pid != null) pid = String(first.pid).trim();
        if (first.uid != null) author_uid = String(first.uid).trim();
        if (first.subject != null) subject = String(first.subject).trim();
        if (first.dateline != null) {
          const dl = typeof first.dateline === "number" ? first.dateline : Number(first.dateline);
          if (Number.isFinite(dl)) dateFromPost = dl;
        }
      }
    } catch {
      warnings.push(`${folder}: no or invalid posts.json — using event fallbacks for dates/pid`);
    }

    const dateVal = dateFromPost ?? dateFallback;
    const numberVal = Number.isFinite(folderNum) ? folderNum : editionFallback;

    if (dateVal == null || !Number.isFinite(dateVal)) {
      warnings.push(`${folder}: cannot determine edition date — skip`);
      continue;
    }
    if (numberVal == null || !Number.isFinite(numberVal)) {
      warnings.push(`${folder}: cannot determine edition number — skip`);
      continue;
    }

    const uniqueDates = new Set<number>();
    const uniqueEds = new Set<number>();
    for (const ev of eventObjs) {
      if (ev.date != null) {
        const n = typeof ev.date === "number" ? ev.date : Number(ev.date);
        if (Number.isFinite(n)) uniqueDates.add(n);
      }
      if (ev.edition != null) {
        const n = typeof ev.edition === "number" ? ev.edition : Number(ev.edition);
        if (Number.isFinite(n)) uniqueEds.add(n);
      }
    }
    if (uniqueDates.size > 1) {
      warnings.push(`${folder}: inconsistent event dates ${[...uniqueDates].join(", ")}`);
    }
    if (uniqueEds.size > 1) {
      warnings.push(`${folder}: inconsistent event edition values ${[...uniqueEds].join(", ")}`);
    }
    if (Number.isFinite(folderNum) && uniqueEds.size === 1) {
      const only = [...uniqueEds][0];
      if (only !== folderNum) {
        warnings.push(`${folder}: folder name edition ${folderNum} vs event edition ${only} (using folder + post data)`);
      }
    }

    const edition: EditionMeta = {
      number: numberVal,
      date: dateVal,
      pid,
      author_uid,
      subject,
    };

    for (const ev of eventObjs) stripEventMeta(ev);

    data.edition = edition;
    data.events = events;

    await writeFile(evPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    migrated++;
  }

  console.log(`Migrated ${migrated} file(s); already ok: ${skipped}`);
  if (warnings.length) {
    for (const w of warnings.slice(0, 100)) console.warn(w);
    if (warnings.length > 100) console.warn(`… and ${warnings.length - 100} more warnings`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
