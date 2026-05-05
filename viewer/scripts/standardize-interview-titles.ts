/**
 * Normalize every interviews event title to:
 *   Interview with X conducted by Y.
 * (or Joint interview … / Group interview … when the source used those prefixes).
 *
 * Drops "; covers …", "; discusses …", ", published …", trailing ellipsis, etc. from titles only.
 *
 * Run from repo root: bun run viewer/scripts/standardize-interview-titles.ts
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

function squash(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function norm(s: string): string {
  return squash(s)
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[™.]/g, "")
    .trim();
}

/** Strip trailing summary clauses and ellipsis from a name phrase */
function trimParticipant(s: string): string {
  let t = squash(s);
  t = t.replace(/\s*;\s*a self-interview\b.*$/i, "");
  t = t.replace(/\s*;\s*covers\b.*$/i, "");
  t = t.replace(/\s*;\s*discusses\b.*$/i, "");
  t = t.replace(/\s*;\s*focused on\b.*$/i, "");
  t = t.replace(/\s*;\s*written up as\b.*$/i, "");
  t = t.replace(/\s*,\s*published\b.*$/i, "");
  t = t.replace(/\s*,\s*enjoy\b.*$/i, "");
  t = t.replace(/\s+features\s+a\s+video\s+interview\s+with\b.*$/i, "");
  t = t.replace(/\s*…+\s*$/u, "");
  t = t.replace(/\s*\.\.\.\s*$/, "");
  t = t.replace(/^["'`]+/, "").replace(/["'`]+$/, "");
  t = t.replace(/\s*[;.]\s*$/, "");
  return squash(t);
}

function pidFromUrl(url: string): string {
  const m = /(?:\?|&)pid=(\d+)/i.exec(url ?? "");
  return m?.[1] ?? "";
}

/** Common HF News publisher UID when missing from events.json user lists */
const EXTRA_UID_USERNAME = new Map<string, string>([["515249", "Sir"]]);

function buildUidToUsername(events: RawEvent[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const [uid, un] of EXTRA_UID_USERNAME) m.set(uid, un);
  for (const ev of events) {
    for (const u of ev.users ?? []) {
      const uid = u.uid?.trim();
      const un = u.username?.trim();
      if (uid && un) m.set(uid, un);
    }
  }
  return m;
}

/** First speaker in spoiler after Interview header matching interviewee, excluding interviewee */
function interviewerFromInterviewSection(message: string, interviewee: string): string | null {
  const nh = norm(interviewee);
  if (!nh) return null;

  const headerRe =
    /\[font=Monotype Corsiva\]Interview(?: \d+)?\s*-\s*([^<\[\]]+?)\s*\[\/font\]/gi;
  let mh: RegExpExecArray | null;
  while ((mh = headerRe.exec(message)) !== null) {
    const subjectRaw = squash(mh[1]).replace(/:$/, "").trim();
    if (!subjectRaw || norm(subjectRaw) !== nh) continue;

    const start = mh.index + mh[0].length;
    const rest = message.slice(start);
    const nextHdr = rest.search(/\[font=Monotype Corsiva\]Interview(?: \d+)?\s*-\s*/i);
    const chunk = nextHdr >= 0 ? rest.slice(0, nextHdr) : rest;

    const speakerRes: RegExp[] = [
      /\[b\]\[color=[^\]]+\]\s*([^[\]]+?):\s*\[\/color\]\[\/b\]/gi,
      /\[color=[^\]]+\]\[b\]\s*([^[\]]+?):\s*\[\/b\]\[\/color\]/gi,
      /\[b\]\s*\[color=[^\]]+\]\s*([^[\]]+?):\s*\[\/color\]\s*\[\/b\]/gi,
    ];
    for (const sr of speakerRes) {
      sr.lastIndex = 0;
      let sm: RegExpExecArray | null;
      while ((sm = sr.exec(chunk)) !== null) {
        const name = squash(sm[1]).replace(/:$/, "").trim();
        if (!name || norm(name) === nh) continue;
        return name.replace(/\.$/, "").trim();
      }
    }
  }
  return null;
}

/** Newer editions: By line after Interview.png before interview content */
function interviewerAfterInterviewBanner(message: string): string | null {
  const idx =
    message.search(/Interview\.png/i) >= 0
      ? message.search(/Interview\.png/i)
      : message.search(/\/Interview\.png/i);
  if (idx < 0) return null;
  const slice = message.slice(idx, idx + 3500);
  const byRe =
    /\[align=center\]\[b\]\[i\]By\s*\[url=https?:\/\/(?:www\.)?hackforums\.net\/member\.php\?action=profile&uid=\d+\]\s*([^[]+?)\s*\[\/url\]\s*\[\/i\]\[\/b\]\[\/align\]/gi;
  let best = "";
  let m: RegExpExecArray | null;
  while ((m = byRe.exec(slice)) !== null) {
    best = squash(m[1]).replace(/\.$/, "").trim();
  }
  return best || null;
}

/** [url][color][b]Name:[/b][/color][/url] dialogue lines (v1 layouts after Interview.png) */
function interviewerFromBbSpeakerLines(message: string, interviewee: string): string | null {
  const nh = norm(interviewee);
  const ix = message.search(/Interview\.png/i);
  const haystack = ix >= 0 ? message.slice(ix, ix + 20000) : message;

  const re =
    /\[url=http:\/\/(?:www\.)?hackforums\.net\/member\.php\?action=profile&uid=\d+\]\[color=[^\]]+\]\[b\]([^\[:]+):\[\/b\]\[\/color\]\[\/url\]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(haystack)) !== null) {
    const label = squash(m[1]).replace(/:$/, "").trim();
    if (!label || norm(label) === nh) continue;
    return label.replace(/\.$/, "").trim();
  }
  return null;
}

/** Early HF News: [color=#1E90FF][b]InterviewerName:[/b][/color] between numbered questions */
function interviewerFromLegacyBlueLabels(message: string, interviewee: string): string | null {
  const nh = norm(interviewee);
  const re = /\[color=#1E90FF\]\[b\]([^\[:]+):\[\/b\]\[\/color\]/gi;
  let last = "";
  let m: RegExpExecArray | null;
  while ((m = re.exec(message)) !== null) {
    let label = squash(m[1]).replace(/:$/, "").trim();
    if (/^\d+\.?\s*$/.test(label)) continue;
    if (/link here/i.test(label)) continue;
    if (!label || norm(label) === nh) continue;
    last = label;
  }
  return last ? last.replace(/\.$/, "").trim() : null;
}

/** Video / webshow title patterns — guest only in title */
function videoGuestFromTitle(title: string): string | null {
  const t = title.trim();
  const patterns = [
    /(?:exclusive\s+)?video\s+interview\s+with\s+([^.,;]+)/i,
    /features\s+a\s+video\s+interview\s+with\s+([^.,;]+)/i,
    /webshow\s+part\s+two\s+features\s+a\s+video\s+interview\s+with\s+([^.,;]+)/i,
  ];
  for (const re of patterns) {
    const m = re.exec(t);
    if (m?.[1]) return trimParticipant(m[1]);
  }
  return null;
}

type Parsed =
  | { kind: "ok"; prefix: string; subject: string; interviewer: string }
  | { kind: "fail"; reason: string };

function parseFromBlob(blob: string): Parsed | null {
  const b = squash(blob);

  const multiInv = /\bmulti-interview by\s+(.+?)\s+with\s+(.+?)(?=;|$)/i.exec(b);
  if (multiInv) {
    return {
      kind: "ok",
      prefix: "Group interview",
      subject: trimParticipant(multiInv[2]),
      interviewer: trimParticipant(multiInv[1]),
    };
  }

  const interviewsVerb =
    /^(.+?)\s+interviews\s+(.+?)(?:\s+about\b|\s+for\b|\s+on\b|\s+regarding\b|,|\.|;|$)/i.exec(b);
  if (interviewsVerb && !/^interview\b/i.test(interviewsVerb[1])) {
    return {
      kind: "ok",
      prefix: "Interview",
      subject: trimParticipant(interviewsVerb[2]),
      interviewer: trimParticipant(interviewsVerb[1]),
    };
  }

  const mf = /^Multi-faction HackerCraft interview by\s+(.+?)\s+with\s+(.+?)(?:;|$)/i.exec(b);
  if (mf) {
    return {
      kind: "ok",
      prefix: "Group interview",
      subject: trimParticipant(mf[2]),
      interviewer: trimParticipant(mf[1]),
    };
  }

  const gm =
    /^Multi-part Graphic Masters interview conducted by\s+(.+?)\s+with\s+(.+?)(?:;|$)/i.exec(b);
  if (gm) {
    return {
      kind: "ok",
      prefix: "Interview",
      subject: trimParticipant(gm[2]),
      interviewer: trimParticipant(gm[1]),
    };
  }

  const joke = /^['']Jokeview['']\s+with\s+(.+?)\s+conducted\s+by\s+(.+?)(?:;|,|$)/i.exec(b);
  if (joke) {
    return {
      kind: "ok",
      prefix: "Interview",
      subject: trimParticipant(joke[1]),
      interviewer: trimParticipant(joke[2]),
    };
  }

  const joint = /^Joint interview with\s+(.+?)\s+conducted\s+by\s+(.+?)(?=;|$)/i.exec(b);
  if (joint) {
    return {
      kind: "ok",
      prefix: "Joint interview",
      subject: trimParticipant(joint[1]),
      interviewer: trimParticipant(joint[2]),
    };
  }

  const group = /^Group interview with\s+(.+?)\s+conducted\s+by\s+(.+?)(?=;|$)/i.exec(b);
  if (group) {
    return {
      kind: "ok",
      prefix: "Group interview",
      subject: trimParticipant(group[1]),
      interviewer: trimParticipant(group[2]),
    };
  }

  const invBy = /\bInterview with\s+(.+?)\s+conducted\s+by\s+(.+?)(?=;|$)/i.exec(b);
  if (invBy) {
    return {
      kind: "ok",
      prefix: "Interview",
      subject: trimParticipant(invBy[1]),
      interviewer: trimParticipant(invBy[2]),
    };
  }

  const qa = /^Q&A\s+interview\s+with\s+([^.;]+?)(?:;|$)/i.exec(b);
  if (qa) {
    return {
      kind: "ok",
      prefix: "Interview",
      subject: trimParticipant(qa[1]),
      interviewer: "",
    };
  }

  const comedicSelf = /^Comedic\s+self-interview\s+by\s+(.+?)\.?$/i.exec(b);
  if (comedicSelf) {
    const name = trimParticipant(comedicSelf[1]);
    return { kind: "ok", prefix: "Interview", subject: name, interviewer: name };
  }

  const plainSelf = /^self-interview\s+by\s+(.+?)\.?$/i.exec(b);
  if (plainSelf) {
    const name = trimParticipant(plainSelf[1]);
    return { kind: "ok", prefix: "Interview", subject: name, interviewer: name };
  }

  const invBare =
    /^Interview with\s+([^.;]+?)\.(?:\s*$|$)/i.exec(b) ??
    /^Interview with\s+([^.;]+?)$/i.exec(b);
  if (invBare && !/\bconducted\s+by\b/i.test(b)) {
    return {
      kind: "ok",
      prefix: "Interview",
      subject: trimParticipant(invBare[1]),
      interviewer: "",
    };
  }

  return null;
}

function composeTitle(prefix: string, subject: string, interviewer: string): string {
  const X = trimParticipant(subject);
  const Y = trimParticipant(interviewer);
  return `${prefix} with ${X} conducted by ${Y}.`;
}

function intervieweeFromTitleFallback(title: string): string | null {
  const t = squash(title);
  const m =
    /^Interview with\s+(.+?)(?:\s+conducted\s+by\b|[;.]|$)/i.exec(t) ??
    /^Interview with\s+(.+)$/i.exec(t);
  if (!m?.[1]) return null;
  const chunk = trimParticipant(m[1]);
  return chunk || null;
}

function inferCounterpartyUsers(ev: RawEvent, intervieweeGuess: string): string | null {
  const users = ev.users?.filter((u) => u.username?.trim()) ?? [];
  if (users.length !== 2) return null;
  const names = users.map((u) => u.username!.trim());
  const ie = norm(intervieweeGuess);
  const [a, b] = names;
  if (norm(a) === ie && norm(b) !== ie) return b;
  if (norm(b) === ie && norm(a) !== ie) return a;
  const blob = squash(`${ev.title} ${ev.description ?? ""}`);
  const idx = blob.toLowerCase().indexOf("interview with");
  if (idx >= 0) {
    const tail = blob.slice(idx + "interview with".length).trimStart();
    if (tail.toLowerCase().startsWith(a.toLowerCase())) return b;
    if (tail.toLowerCase().startsWith(b.toLowerCase())) return a;
  }
  return null;
}

async function main() {
  const dirents = await readdir(editionsDir, { withFileTypes: true });
  let updatedFiles = 0;
  let updatedTitles = 0;
  const warnings: string[] = [];

  for (const d of dirents) {
    if (!d.isDirectory() || !editionDir.test(d.name)) continue;
    const evPath = join(editionsDir, d.name, "events.json");
    let raw: string;
    try {
      raw = await readFile(evPath, "utf8");
    } catch {
      continue;
    }

    let data: { events?: RawEvent[] };
    try {
      data = JSON.parse(raw) as { events?: RawEvent[] };
    } catch {
      warnings.push(`${d.name}: invalid events.json`);
      continue;
    }

    const events = data.events;
    if (!Array.isArray(events)) continue;

    const postsMessageByPid = new Map<string, string>();
    const postsUidByPid = new Map<string, string>();
    try {
      const postsRaw = await readFile(join(editionsDir, d.name, "posts.json"), "utf8");
      const postsData = JSON.parse(postsRaw) as {
        posts?: { pid: string; uid?: string; message: string }[];
      };
      for (const p of postsData.posts ?? []) {
        if (!p?.pid) continue;
        if (typeof p.message === "string") postsMessageByPid.set(p.pid, p.message);
        if (p.uid != null && String(p.uid).trim()) postsUidByPid.set(p.pid, String(p.uid));
      }
    } catch {
      /* optional */
    }

    const uidToUser = buildUidToUsername(events as RawEvent[]);
    let fileChanged = false;

    for (const ev of events) {
      if (!ev || ev.category !== "interviews") continue;

      const desc = (ev.description ?? "").trim();
      const blobPieces = [squash(desc), squash(ev.title), squash(`${desc}\n${ev.title}`)].filter(
        Boolean,
      );
      let parsed: Parsed | null = null;
      for (const blob of blobPieces) {
        parsed = parseFromBlob(blob);
        if (parsed) break;
      }

      if (!parsed || (parsed.kind === "ok" && !parsed.interviewer)) {
        const guest = videoGuestFromTitle(ev.title);
        if (guest) {
          parsed = {
            kind: "ok",
            prefix: "Interview",
            subject: guest,
            interviewer: "",
          };
        }
      }

      if (parsed?.kind === "ok" && !parsed.interviewer) {
        const pid = pidFromUrl(ev.url ?? "");
        const msg = pid ? postsMessageByPid.get(pid) : undefined;
        if (msg) {
          const byBanner = interviewerAfterInterviewBanner(msg);
          const bbSpeaker = interviewerFromBbSpeakerLines(msg, parsed.subject);
          const bySection = interviewerFromInterviewSection(msg, parsed.subject);
          const legacyBlue = interviewerFromLegacyBlueLabels(msg, parsed.subject);
          parsed.interviewer =
            byBanner ??
            bbSpeaker ??
            bySection ??
            legacyBlue ??
            parsed.interviewer;
        }
      }

      if (parsed?.kind === "ok" && !parsed.interviewer) {
        const ie =
          parsed.subject ||
          intervieweeFromTitleFallback(ev.title) ||
          ev.users?.find((u) => u.username)?.username?.trim() ||
          "";
        const pair = inferCounterpartyUsers(ev, ie);
        if (pair) parsed.interviewer = pair;
      }

      if (parsed?.kind === "ok" && !parsed.interviewer) {
        const pid = pidFromUrl(ev.url ?? "");
        const postUid = pid ? postsUidByPid.get(pid) : undefined;
        const publisher = postUid ? uidToUser.get(String(postUid)) : undefined;
        if (publisher && /^Q&A\s+interview/i.test(ev.title.trim())) parsed.interviewer = publisher;
      }

      // Exclusive video — publisher fallback (post author)
      if (
        parsed?.kind === "ok" &&
        !parsed.interviewer &&
        /exclusive\s+video\s+interview|video\s+interview\s+with/i.test(ev.title)
      ) {
        const pid = pidFromUrl(ev.url ?? "");
        const postUid = pid ? postsUidByPid.get(pid) : undefined;
        const publisher = postUid ? uidToUser.get(String(postUid)) : undefined;
        if (publisher) parsed.interviewer = publisher;
      }

      // Webshow video guest — Cobalt+ hosted Misc edition Part Two (see edition 58.1 posts)
      if (
        parsed?.kind === "ok" &&
        !parsed.interviewer &&
        /webshow\s+part\s+two\s+features\s+a\s+video\s+interview/i.test(ev.title.toLowerCase())
      ) {
        parsed.interviewer = "Cobalt+";
      }

      // Very old editions: post author when there is no Interview.png banner interview layout
      if (parsed?.kind === "ok" && !parsed.interviewer && parsed.subject) {
        const pid = pidFromUrl(ev.url ?? "");
        const msg = pid ? postsMessageByPid.get(pid) : "";
        if (msg && !/Interview\.png/i.test(msg)) {
          const postUid = pid ? postsUidByPid.get(pid) : undefined;
          const publisher = postUid ? uidToUser.get(String(postUid)) : undefined;
          if (publisher && norm(publisher) !== norm(parsed.subject)) {
            parsed.interviewer = publisher;
          }
        }
      }

      if (!parsed || parsed.kind !== "ok") {
        warnings.push(`${d.name}: could not parse interview — "${ev.title.slice(0, 80)}"`);
        continue;
      }

      if (!parsed.interviewer) {
        warnings.push(`${d.name}: missing interviewer — "${ev.title.slice(0, 80)}"`);
        continue;
      }

      const nextTitle = composeTitle(parsed.prefix, parsed.subject, parsed.interviewer);
      if (nextTitle !== ev.title) {
        ev.title = nextTitle;
        fileChanged = true;
        updatedTitles++;
      }
    }

    if (fileChanged) {
      await writeFile(evPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
      updatedFiles++;
    }
  }

  console.log(`Updated ${updatedTitles} title(s) in ${updatedFiles} file(s)`);
  if (warnings.length) {
    console.warn(warnings.join("\n"));
    console.warn(`Total warnings: ${warnings.length}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
