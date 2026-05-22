// Temporary triage UI for events without `tags`.
//
// Run modes:
//   node scripts/triage_untagged_server.js          # start the server
//   node scripts/triage_untagged_server.js --apply  # apply decisions to events.json
//
// Workflow:
//   1. Start the server, open http://localhost:8765 in a browser.
//   2. Walk the list of untagged events, click tag chips to attach tags, or
//      click "no tags" if none apply. Progress is saved to localStorage so
//      you can close the tab and come back later.
//   3. Click "Done" — the server writes scripts/triage_decisions.json.
//   4. Re-run with --apply to merge the decisions into the per-edition
//      events.json files. The triage file stays on disk for audit.
//
// One-off — delete after the curation pass is finished.

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const EDITIONS_DIR = path.join(ROOT, "editions");
const OUTPUT_FILE = path.join(__dirname, "triage_decisions.json");
const PORT = 8765;

const CANONICAL_TAGS = [
  "rules", "awards", "rkos", "holidays", "moderation", "forums",
  "features", "town-hall", "site-maintenance", "usergroups",
  "infrastructure", "theme", "bug-fixes", "drama", "hf-news-ops",
  "milestones", "omniscient-personal",
];
const SKIP_CATEGORIES = new Set(["interviews", "news"]);

/** Scan editions and collect every event without a `tags` array (or empty). */
function loadUntaggedEvents() {
  const out = [];
  const eds = fs.readdirSync(EDITIONS_DIR).sort((a, b) => {
    const na = Number.parseFloat(a);
    const nb = Number.parseFloat(b);
    return Number.isFinite(na) && Number.isFinite(nb) ? na - nb : a.localeCompare(b);
  });
  for (const ed of eds) {
    const p = path.join(EDITIONS_DIR, ed, "events.json");
    if (!fs.existsSync(p)) continue;
    let doc;
    try { doc = JSON.parse(fs.readFileSync(p, "utf8")); } catch { continue; }
    if (!Array.isArray(doc.events)) continue;
    doc.events.forEach((ev, idx) => {
      if (SKIP_CATEGORIES.has(ev.category)) return;
      const tags = Array.isArray(ev.tags) ? ev.tags : [];
      if (tags.length > 0) return;
      out.push({
        id: `${ed}-${idx}`,
        ed,
        idx,
        category: ev.category || "",
        title: ev.title || "",
        description: ev.description || "",
      });
    });
  }
  return out;
}

// ---------- --apply mode ----------
if (process.argv.includes("--apply")) {
  if (!fs.existsSync(OUTPUT_FILE)) {
    console.error(`No decisions file at ${OUTPUT_FILE}. Run without --apply first.`);
    process.exit(1);
  }
  const payload = JSON.parse(fs.readFileSync(OUTPUT_FILE, "utf8"));
  const decisions = payload.decisions || {};
  let touched = 0;
  let noTagDecisions = 0;
  let withTagDecisions = 0;
  // Group decisions by edition so we open each events.json once.
  const byEd = new Map();
  for (const [id, dec] of Object.entries(decisions)) {
    const m = id.match(/^(.+)-(\d+)$/);
    if (!m) continue;
    const ed = m[1];
    const idx = Number.parseInt(m[2], 10);
    if (!byEd.has(ed)) byEd.set(ed, []);
    byEd.get(ed).push({ idx, tags: Array.isArray(dec.tags) ? dec.tags : [] });
  }
  for (const [ed, items] of byEd) {
    const p = path.join(EDITIONS_DIR, ed, "events.json");
    if (!fs.existsSync(p)) { console.warn(`skip ${ed}: no events.json`); continue; }
    const raw = fs.readFileSync(p, "utf8");
    const doc = JSON.parse(raw);
    for (const { idx, tags } of items) {
      const ev = doc.events?.[idx];
      if (!ev) { console.warn(`ed ${ed}: missing event at index ${idx}`); continue; }
      const clean = tags
        .map((t) => (typeof t === "string" ? t.trim() : ""))
        .filter((t) => t && CANONICAL_TAGS.includes(t));
      if (clean.length === 0) {
        delete ev.tags;
        noTagDecisions++;
      } else {
        ev.tags = [...new Set(clean)].sort();
        withTagDecisions++;
      }
      touched++;
    }
    const line3 = raw.split("\n")[2] || "";
    const indent = /^\s{8}/.test(line3) ? 4 : 2;
    fs.writeFileSync(p, JSON.stringify(doc, null, indent) + "\n");
  }
  console.log(`Applied ${touched} decisions (${withTagDecisions} tagged, ${noTagDecisions} explicitly cleared).`);
  process.exit(0);
}

// ---------- server mode ----------
const events = loadUntaggedEvents();
console.log(`Loaded ${events.length} untagged events.`);

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Untagged Event Triage</title>
<style>
  :root { color-scheme: dark; --bg:#141414; --panel:#1f1f1f; --border:#2c3a4a; --text:#c3c3c3; --muted:#8f8f8f; --accent:#0F5799; --accent-text:#499FED; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Segoe UI", system-ui, sans-serif; background: var(--bg); color: var(--text); line-height: 1.45; }
  header { position: sticky; top: 0; z-index: 10; background: #072948; color: #efefef; padding: 0.75rem 1rem; display: flex; flex-wrap: wrap; align-items: center; gap: 1rem; box-shadow: 0 2px 8px rgba(0,0,0,.4); }
  header h1 { margin: 0; font-size: 1.05rem; font-weight: bold; text-shadow: 1px 1px 0 #000; }
  header .progress { font-variant-numeric: tabular-nums; color: #efefef; }
  header select { background: #072948; color: #efefef; border: 1px solid #0F5799; padding: 0.3rem 0.5rem; border-radius: 4px; }
  header button { background: #0F5799; color: #efefef; border: 1px solid #499FED; padding: 0.4rem 0.9rem; border-radius: 4px; cursor: pointer; font-weight: bold; text-shadow: 1px 1px 0 #000; }
  header button:hover { background: #499FED; color: #072948; }
  header button.primary { background: #2c8a3b; border-color: #4eaa5c; }
  header button.primary:hover { background: #4eaa5c; color: #0a3b15; }
  main { max-width: 56rem; margin: 0 auto; padding: 1rem; }
  .meta { color: var(--muted); font-size: 0.85rem; margin: 0.5rem 0 1rem; }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 0.9rem 1rem; margin-bottom: 0.85rem; }
  .card.is-decided { border-color: #2c8a3b; background: #182218; }
  .card-head { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem; margin-bottom: 0.35rem; }
  .card-ed { font-weight: bold; color: #fff; }
  .card-cat { display: inline-block; padding: 0.1rem 0.55rem; border-radius: 999px; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; background: #2c3a4a; color: #efefef; }
  .card-title { font-weight: 600; color: #fff; margin: 0.2rem 0 0.3rem; }
  .card-desc { color: var(--muted); font-size: 0.9rem; white-space: pre-wrap; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.7rem; }
  .chip { background: transparent; color: var(--text); border: 1px solid var(--border); border-radius: 999px; padding: 0.25rem 0.7rem; font-size: 0.82rem; cursor: pointer; font-family: inherit; }
  .chip:hover { background: rgba(15,87,153,.2); color: var(--accent-text); border-color: var(--accent); }
  .chip.is-on { background: #0F5799; color: #fff; border-color: #499FED; }
  .chip.no-tags { font-style: italic; }
  .chip.no-tags.is-on { background: #5a2828; border-color: #a04444; color: #fff; }
  .controls { display: flex; align-items: center; gap: 1rem; padding-top: 0.5rem; }
  .controls .pager { color: var(--muted); }
  .empty { padding: 4rem 1rem; text-align: center; color: var(--muted); }
  .toast { position: fixed; right: 1rem; bottom: 1rem; background: #1a2a1a; border: 1px solid #4eaa5c; color: #cfeacf; padding: 0.65rem 1rem; border-radius: 6px; box-shadow: 0 8px 24px rgba(0,0,0,.4); display: none; }
  .toast.is-error { background: #2a1a1a; border-color: #a04444; color: #ecc; }
  .toast.is-show { display: block; }
</style>
</head>
<body>
<header>
  <h1>Untagged Event Triage</h1>
  <span class="progress" id="progress">…</span>
  <select id="catFilter">
    <option value="">All categories</option>
  </select>
  <select id="decidedFilter">
    <option value="undecided">Undecided only</option>
    <option value="all">All events</option>
    <option value="decided">Decided only</option>
  </select>
  <button id="btn-clear" type="button">Clear local state</button>
  <button id="btn-done" type="button" class="primary">Done — save file</button>
</header>
<main>
  <p class="meta">Click tag chips to attach tags. Click <em>no tags apply</em> if an event genuinely shouldn't have any. Progress is saved in your browser; close and resume freely.</p>
  <div id="list"></div>
  <div class="controls">
    <span class="pager" id="pager"></span>
    <button id="btn-prev" type="button">‹ Prev 50</button>
    <button id="btn-next" type="button">Next 50 ›</button>
  </div>
</main>
<div class="toast" id="toast"></div>
<script>
  const TAGS = ${JSON.stringify(CANONICAL_TAGS)};
  const PAGE = 50;
  const STORAGE_KEY = "hfnews_triage_v1";
  let allEvents = [];
  let decisions = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  let page = 0;
  let catFilter = "";
  let decidedFilter = "undecided";

  function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(decisions)); }
  function isDecided(id) { return Object.prototype.hasOwnProperty.call(decisions, id); }

  function filteredEvents() {
    return allEvents.filter((e) => {
      if (catFilter && e.category !== catFilter) return false;
      const d = isDecided(e.id);
      if (decidedFilter === "undecided" && d) return false;
      if (decidedFilter === "decided" && !d) return false;
      return true;
    });
  }

  function renderProgress() {
    const total = allEvents.length;
    const decided = allEvents.filter((e) => isDecided(e.id)).length;
    document.getElementById("progress").textContent =
      total === 0 ? "(no events)" : decided + " / " + total + " decided (" + Math.round(decided/total*100) + "%)";
  }

  function renderPager(list) {
    const total = list.length;
    const start = page * PAGE;
    const end = Math.min(start + PAGE, total);
    document.getElementById("pager").textContent =
      total === 0 ? "(no events match filters)" : "Showing " + (start + 1) + "–" + end + " of " + total;
  }

  function renderList() {
    const list = filteredEvents();
    if (page * PAGE >= list.length && page > 0) page = Math.max(0, Math.ceil(list.length / PAGE) - 1);
    const start = page * PAGE;
    const slice = list.slice(start, start + PAGE);
    const root = document.getElementById("list");
    if (slice.length === 0) {
      root.innerHTML = '<p class="empty">Nothing left in this filter.</p>';
    } else {
      root.innerHTML = slice.map((e) => renderCard(e)).join("");
      for (const card of root.querySelectorAll(".card")) {
        const id = card.dataset.id;
        card.querySelectorAll(".chip").forEach((chip) => {
          chip.addEventListener("click", () => toggleTag(id, chip.dataset.tag));
        });
      }
    }
    renderProgress();
    renderPager(list);
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\\\"":"&quot;","'":"&#39;"}[c])); }

  function renderCard(e) {
    const decided = decisions[e.id];
    const selectedTags = decided ? new Set(decided.tags) : new Set();
    const noTags = decided && decided.tags.length === 0;
    const chipsHtml = TAGS.map((t) =>
      '<button type="button" class="chip' + (selectedTags.has(t) ? " is-on" : "") + '" data-tag="' + t + '">' + t + '</button>'
    ).join("");
    return [
      '<div class="card' + (decided ? " is-decided" : "") + '" data-id="' + e.id + '">',
      '  <div class="card-head">',
      '    <span class="card-ed">Edition ' + escapeHtml(e.ed) + '</span>',
      '    <span class="card-cat">' + escapeHtml(e.category) + '</span>',
      '  </div>',
      '  <div class="card-title">' + escapeHtml(e.title) + '</div>',
      '  <div class="card-desc">' + escapeHtml(e.description) + '</div>',
      '  <div class="chips">',
      chipsHtml,
      '    <button type="button" class="chip no-tags' + (noTags ? " is-on" : "") + '" data-tag="__none__">no tags apply</button>',
      '  </div>',
      '</div>',
    ].join("");
  }

  function toggleTag(id, tag) {
    if (!decisions[id]) decisions[id] = { tags: [] };
    if (tag === "__none__") {
      decisions[id].tags = decisions[id].tags.length === 0 && Object.prototype.hasOwnProperty.call(decisions, id) ? ["__remove_decision__"] : [];
      // Clicking "no tags" while it's already on un-decides the event.
      if (decisions[id].tags[0] === "__remove_decision__") delete decisions[id];
    } else {
      const s = new Set(decisions[id].tags);
      if (s.has(tag)) s.delete(tag);
      else s.add(tag);
      decisions[id].tags = [...s].sort();
    }
    save();
    renderList();
  }

  async function loadEvents() {
    const r = await fetch("/api/events");
    if (!r.ok) throw new Error("Failed to load: " + r.status);
    allEvents = await r.json();
    const cats = [...new Set(allEvents.map((e) => e.category))].sort();
    const sel = document.getElementById("catFilter");
    cats.forEach((c) => { const o = document.createElement("option"); o.value = c; o.textContent = c; sel.appendChild(o); });
    renderList();
  }

  function showToast(msg, isError) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.toggle("is-error", !!isError);
    t.classList.add("is-show");
    setTimeout(() => t.classList.remove("is-show"), 3500);
  }

  async function done() {
    const payload = { applied_at: new Date().toISOString(), decisions };
    try {
      const r = await fetch("/api/save", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      showToast("Saved " + j.count + " decisions to " + j.path);
    } catch (err) {
      showToast("Save failed: " + err.message, true);
    }
  }

  document.getElementById("catFilter").addEventListener("change", (e) => { catFilter = e.target.value; page = 0; renderList(); });
  document.getElementById("decidedFilter").addEventListener("change", (e) => { decidedFilter = e.target.value; page = 0; renderList(); });
  document.getElementById("btn-clear").addEventListener("click", () => {
    if (confirm("Clear all triage decisions saved in this browser?")) { decisions = {}; save(); renderList(); }
  });
  document.getElementById("btn-done").addEventListener("click", done);
  document.getElementById("btn-prev").addEventListener("click", () => { if (page > 0) { page--; renderList(); window.scrollTo({ top: 0 }); } });
  document.getElementById("btn-next").addEventListener("click", () => { page++; renderList(); window.scrollTo({ top: 0 }); });

  loadEvents().catch((err) => { document.getElementById("list").innerHTML = '<p class="empty">' + escapeHtml(err.message) + "</p>"; });
</script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(HTML);
    return;
  }
  if (req.method === "GET" && req.url === "/api/events") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(events));
    return;
  }
  if (req.method === "POST" && req.url === "/api/save") {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const decisions = body.decisions || {};
        const count = Object.keys(decisions).length;
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(body, null, 2));
        console.log(`Saved ${count} decisions to ${OUTPUT_FILE}`);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, count, path: path.relative(ROOT, OUTPUT_FILE).replace(/\\/g, "/") }));
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(err) }));
      }
    });
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, () => {
  console.log(`Triage UI: http://localhost:${PORT}`);
  console.log("Open in a browser, triage the events, click Done.");
  console.log(`When ready to apply: node scripts/triage_untagged_server.js --apply`);
  console.log("Press Ctrl-C to stop the server.");
});
