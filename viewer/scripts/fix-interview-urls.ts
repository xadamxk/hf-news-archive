/**
 * Set events.json interview URLs to https://hackforums.net/showthread.php?pid=<pid>
 * where pid is the HF News post containing that interview (from editions/<e>/posts.json).
 *
 * Run: bun run viewer/scripts/fix-interview-urls.ts
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const viewerRoot = join(__dirname, "..");
const repoRoot = join(viewerRoot, "..");
const editionsDir = join(repoRoot, "editions");
const editionDir = /^\d+(?:\.\d+)?$/;

type RawUser = { uid?: string; username?: string };
type RawEvent = {
  category: string;
  title: string;
  description?: string;
  url?: string;
  users?: RawUser[];
  date: number;
  edition: number;
};

type Post = { pid: string; message: string };

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[™.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** True if message plausibly contains an HF News interview section (not e.g. "Interviewers"). */
function hasInterviewSection(msg: string): boolean {
  if (/\bhfninterviews\b/i.test(msg)) return true;
  if (/\binterview\b/i.test(msg)) return true;
  return false;
}

/** Interviewee / subject name hint from title / description. */
function intervieweeNameHint(ev: RawEvent): string {
  const blob = `${ev.title}\n${ev.description ?? ""}`;
  const tryTrim = (s: string) =>
    s
      .split(/[;(]/)[0]
      .replace(/\s*….*$/, "")
      .replace(/\.$/, "")
      .trim();

  const joint = /\bJoint interview with (.+?) conducted by/im.exec(blob);
  if (joint) {
    const chunk = joint[1].trim();
    const founder = /^(.+?)\s*\(founder\)/i.exec(chunk);
    if (founder) return founder[1].trim();
    const first = chunk.split(/\s+and\s+/i)[0];
    if (first) return first.replace(/\s*\([^)]*\)\s*$/, "").trim();
  }

  const gm = /Multi-part Graphic Masters interview conducted by .+? with\s+([^.;\n]+)/im.exec(blob);
  if (gm) return gm[1].split(/,/)[0].trim();

  const patterns: RegExp[] = [
    /^Interview with (.+?) conducted by/im,
    /^Interview with (.+?)(?:;|,|\s+covers)/im,
    /^Interview with\s+([^.;\n]+)/im,
    /\bQ&A interview with (.+?)(?:;|,|\s+covers|$)/im,
    /\bvideo interview with (.+?)(?:\.|;|,|\s+published|\s+as)/im,
    /Webshow[^\n]*interview with (.+?)\./im,
    /['']Jokeview[''] with (.+?) conducted/im,
    /\bExclusive video interview with (.+?)(?:,|\.|;|\s+published)/im,
    /\bself-interview by (.+?)\./im,
    /\binterview by .+? with (.+?)(?:;|,|\s+covers|$)/im,
  ];
  for (const re of patterns) {
    const m = re.exec(blob);
    if (m?.[1]) return tryTrim(m[1]);
  }
  return "";
}

/** Prefer interviewee uid: user whose username best matches name hint, else infer from title order. */
function intervieweeUid(ev: RawEvent, nameHint: string): string {
  const users = ev.users?.filter((u) => u?.uid) ?? [];
  if (!users.length) return "";
  const nh = norm(nameHint);
  if (nh) {
    for (const u of users) {
      const un = norm(u.username ?? "");
      if (!un) continue;
      if (un === nh) return String(u.uid);
    }
    let best = "";
    let bestScore = 0;
    for (const u of users) {
      const un = norm(u.username ?? "");
      if (!un) continue;
      if (nh.includes(un) || un.includes(nh)) {
        const sc = Math.min(un.length, nh.length);
        if (sc > bestScore) {
          bestScore = sc;
          best = String(u.uid);
        }
      }
    }
    if (best) return best;
  }
  if (users.length === 2) {
    const t = `${ev.title} ${ev.description ?? ""}`.toLowerCase();
    const a = norm(users[0].username ?? "");
    const b = norm(users[1].username ?? "");
    const idx = t.indexOf("interview with");
    if (idx >= 0) {
      const tail = t.slice(idx + 14).trimStart();
      if (a && tail.startsWith(a)) return String(users[0].uid);
      if (b && tail.startsWith(b)) return String(users[1].uid);
    }
    return String(users[1].uid);
  }
  return users.length ? String(users[0].uid) : "";
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Edition 83: comedic Sir piece is not present in scraped posts.json; use main edition opener post. */
const MANUAL_INTERVIEW_PID = new Map<string, string>([
  ["83:Comedic self-interview by Sir.", "20796783"],
]);

function manualPid(ev: RawEvent): string | null {
  const k = `${String(ev.edition)}:${ev.title.trim()}`;
  return MANUAL_INTERVIEW_PID.get(k) ?? null;
}

function findPidForInterview(ev: RawEvent, posts: Post[]): string | null {
  const manual = manualPid(ev);
  if (manual) return manual;

  if (posts.length === 1) return posts[0].pid;

  const nameHint = intervieweeNameHint(ev);
  const uidHint = intervieweeUid(ev, nameHint);
  const blob = `${ev.title} ${ev.description ?? ""}`;

  let bestPid: string | null = null;
  let bestScore = 0;

  for (const p of posts) {
    const msg = p.message;
    if (!hasInterviewSection(msg)) continue;

    let score = 0;
    if (uidHint && msg.includes(`uid=${uidHint}`)) score += 120;

    const nh = norm(nameHint);
    if (nh.length >= 2 && norm(msg).includes(nh)) score += 60;

    if (nh.length >= 2) {
      try {
        if (new RegExp(`\\binterview\\b[^\\n]{0,160}${escapeRe(nh).slice(0, 48)}`, "i").test(msg)) score += 90;
        if (new RegExp(`Interview\\s*[-–]\\s*${escapeRe(nh).slice(0, 48)}`, "i").test(msg)) score += 110;
      } catch {
        /* ignore */
      }
    }

    if (!nameHint || score < 45) {
      const uids = (ev.users ?? []).map((u) => String(u.uid ?? "")).filter(Boolean);
      let uidHits = 0;
      for (const uid of uids) {
        if (msg.includes(`uid=${uid}`)) uidHits++;
      }
      if (uidHits >= 2 && /\binterview\b/i.test(msg)) score += 40 + uidHits * 15;
      if (/multi[- ]faction|hackerCraft/i.test(blob) && /hackerCraft|faction/i.test(msg) && /\binterview\b/i.test(msg))
        score += 55;
    }

    if (score > bestScore) {
      bestScore = score;
      bestPid = p.pid;
    }
  }

  if (bestScore >= 38) return bestPid;
  if (bestPid && bestScore >= 22) return bestPid;

  return null;
}

function hfPidUrl(pid: string): string {
  return `https://hackforums.net/showthread.php?pid=${pid}`;
}

async function main() {
  const dirents = await readdir(editionsDir, { withFileTypes: true });
  let updated = 0;
  let skipped = 0;
  const warnings: string[] = [];

  for (const d of dirents) {
    if (!d.isDirectory() || !editionDir.test(d.name)) continue;
    const evPath = join(editionsDir, d.name, "events.json");
    const postsPath = join(editionsDir, d.name, "posts.json");
    let eventsRaw: string;
    let postsRaw: string;
    try {
      eventsRaw = await readFile(evPath, "utf8");
    } catch {
      continue;
    }
    try {
      postsRaw = await readFile(postsPath, "utf8");
    } catch {
      warnings.push(`${d.name}: no posts.json, skip interviews`);
      continue;
    }

    let data: { events?: RawEvent[] };
    let postsData: { posts?: Post[] };
    try {
      data = JSON.parse(eventsRaw) as { events?: RawEvent[] };
      postsData = JSON.parse(postsRaw) as { posts?: Post[] };
    } catch {
      warnings.push(`${d.name}: invalid JSON`);
      continue;
    }

    const posts = Array.isArray(postsData.posts) ? postsData.posts : [];
    if (!posts.length) continue;

    const events = data.events;
    if (!Array.isArray(events)) continue;

    let changed = false;
    for (const ev of events) {
      if (!ev || ev.category !== "interviews") continue;
      const pid = findPidForInterview(ev, posts);
      if (!pid) {
        warnings.push(`${d.name}: no pid for interview "${ev.title.slice(0, 72)}…"`);
        skipped++;
        continue;
      }
      const next = hfPidUrl(pid);
      if (ev.url?.trim() !== next) {
        ev.url = next;
        changed = true;
        updated++;
      }
    }

    if (changed) {
      await writeFile(evPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    }
  }

  console.log(`Updated ${updated} interview URL(s); unresolved: ${skipped}`);
  if (warnings.length) {
    console.warn(warnings.slice(0, 80).join("\n"));
    if (warnings.length > 80) console.warn(`… and ${warnings.length - 80} more`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
