#!/usr/bin/env node
/**
 * Build a static feed.html from ranf-threads/posts.jsonl
 *
 * Usage:
 *   node scripts/build_ranf_feed.js
 *
 * Output:
 *   ranf-threads/feed.html  — open directly in a browser (no server needed).
 */

const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.join(__dirname, "..");
const POSTS_FILE = path.join(PROJECT_ROOT, "ranf-threads", "posts.jsonl");
const OUT_FILE = path.join(PROJECT_ROOT, "ranf-threads", "feed.html");

function readPosts() {
  if (!fs.existsSync(POSTS_FILE)) {
    console.error(`Missing ${POSTS_FILE}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(POSTS_FILE, "utf8");
  const posts = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      posts.push(JSON.parse(trimmed));
    } catch {
      // skip malformed
    }
  }
  return posts;
}

function main() {
  const posts = readPosts();
  posts.sort((a, b) => Number(b.dateline) - Number(a.dateline));

  const json = JSON.stringify(posts).replace(/<\//g, "<\\/");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>ranf feed (${posts.length} posts)</title>
<style>
  :root { color-scheme: light; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f5f5f7; color: #1a1a1a; margin: 0; padding: 24px 12px; }
  .container { max-width: 760px; margin: 0 auto; }
  header { margin-bottom: 24px; }
  header h1 { margin: 0 0 4px 0; font-size: 20px; }
  header .meta { color: #666; font-size: 13px; }
  article { background: #fff; border: 1px solid #e3e3e6; border-radius: 8px; padding: 16px 20px; margin-bottom: 16px; box-shadow: 0 1px 2px rgba(0,0,0,0.03); }
  article h2 { margin: 0 0 4px 0; font-size: 17px; line-height: 1.35; }
  article h2 a { color: #0a52c2; text-decoration: none; }
  article h2 a:hover { text-decoration: underline; }
  article .ts { color: #777; font-size: 12px; margin-bottom: 12px; }
  .body { font-size: 14.5px; line-height: 1.55; word-wrap: break-word; overflow-wrap: anywhere; }
  .body img { max-width: 100%; height: auto; border-radius: 4px; }
  .body blockquote { border-left: 3px solid #c8c8cf; margin: 8px 0; padding: 4px 12px; background: #f7f7fa; color: #333; }
  .body blockquote cite { display: block; font-style: normal; font-weight: 600; font-size: 12px; color: #555; margin-bottom: 4px; }
  .body pre.code { background: #1f2430; color: #e6e6e6; padding: 10px 12px; border-radius: 4px; overflow-x: auto; font-size: 13px; white-space: pre; }
  .body ul, .body ol { padding-left: 24px; }
  .body a { color: #0a52c2; }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>ranf feed</h1>
    <div class="meta">${posts.length} posts · generated ${new Date().toISOString()}</div>
  </header>
  <main id="feed"></main>
</div>
<script>
const POSTS = JSON.parse(${JSON.stringify(json)});

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeUrl(u) {
  return /^https?:\\/\\//i.test(u) ? u : "";
}
function safeColor(c) {
  if (/^#[0-9a-f]{3,8}$/i.test(c)) return c;
  if (/^[a-z]{3,20}$/i.test(c)) return c.toLowerCase();
  return "";
}
function safeFont(f) {
  if (/^[a-z0-9 ,\\-_'"]{1,80}$/i.test(f)) return f;
  return "";
}
function sizeToEm(n) {
  const map = { 1: "0.7em", 2: "0.85em", 3: "1em", 4: "1.15em", 5: "1.3em", 6: "1.6em", 7: "2em" };
  return map[String(n)] || "1em";
}

function bbcode(input) {
  let s = escapeHtml(input);

  // Code blocks — protect from further parsing
  const codes = [];
  s = s.replace(/\\[(code|php)\\]([\\s\\S]*?)\\[\\/\\1\\]/gi, (_, _tag, body) => {
    codes.push(body);
    return "\\u0000CODE" + (codes.length - 1) + "\\u0000";
  });

  // Quotes (run a few passes for nested quotes)
  for (let i = 0; i < 4; i++) {
    const before = s;
    s = s.replace(/\\[quote=([^\\]]+)\\]([\\s\\S]*?)\\[\\/quote\\]/gi,
      (_, who, body) => '<blockquote><cite>' + who.replace(/^['"]|['"]$/g, "") + ' wrote:</cite>' + body + '</blockquote>');
    s = s.replace(/\\[quote\\]([\\s\\S]*?)\\[\\/quote\\]/gi,
      (_, body) => '<blockquote>' + body + '</blockquote>');
    if (s === before) break;
  }

  // Lists
  s = s.replace(/\\[list(?:=([^\\]]+))?\\]([\\s\\S]*?)\\[\\/list\\]/gi, (_, type, body) => {
    const items = body.split(/\\[\\*\\]/).map(x => x.trim()).filter(Boolean)
      .map(it => '<li>' + it + '</li>').join("");
    if (type && /^[1aAiI]$/.test(type)) return '<ol type="' + type + '">' + items + '</ol>';
    if (type === "1") return '<ol>' + items + '</ol>';
    return '<ul>' + items + '</ul>';
  });

  // Inline formatting — two passes for shallow nesting
  for (let i = 0; i < 2; i++) {
    s = s.replace(/\\[b\\]([\\s\\S]*?)\\[\\/b\\]/gi, '<strong>$1</strong>');
    s = s.replace(/\\[i\\]([\\s\\S]*?)\\[\\/i\\]/gi, '<em>$1</em>');
    s = s.replace(/\\[u\\]([\\s\\S]*?)\\[\\/u\\]/gi, '<u>$1</u>');
    s = s.replace(/\\[s\\]([\\s\\S]*?)\\[\\/s\\]/gi, '<s>$1</s>');
    s = s.replace(/\\[size=([^\\]]+)\\]([\\s\\S]*?)\\[\\/size\\]/gi,
      (_, n, body) => '<span style="font-size:' + sizeToEm(parseInt(n, 10)) + '">' + body + '</span>');
    s = s.replace(/\\[color=([^\\]]+)\\]([\\s\\S]*?)\\[\\/color\\]/gi,
      (_, c, body) => { const col = safeColor(c); return col ? '<span style="color:' + col + '">' + body + '</span>' : body; });
    s = s.replace(/\\[font=([^\\]]+)\\]([\\s\\S]*?)\\[\\/font\\]/gi,
      (_, f, body) => { const fn = safeFont(f); return fn ? '<span style="font-family:' + fn + '">' + body + '</span>' : body; });
    s = s.replace(/\\[align=(left|center|right|justify)\\]([\\s\\S]*?)\\[\\/align\\]/gi,
      '<div style="text-align:$1">$2</div>');
  }

  // Images
  s = s.replace(/\\[img\\]([\\s\\S]*?)\\[\\/img\\]/gi, (_, url) => {
    const u = safeUrl(url.trim());
    return u ? '<img src="' + u + '" alt="" loading="lazy">' : escapeHtml(url);
  });

  // Links with explicit label
  s = s.replace(/\\[url=([^\\]]+)\\]([\\s\\S]*?)\\[\\/url\\]/gi, (_, url, label) => {
    const u = safeUrl(url.trim());
    return u ? '<a href="' + u + '" target="_blank" rel="noopener">' + label + '</a>' : label;
  });
  // Bare url
  s = s.replace(/\\[url\\]([\\s\\S]*?)\\[\\/url\\]/gi, (_, url) => {
    const u = safeUrl(url.trim());
    return u ? '<a href="' + u + '" target="_blank" rel="noopener">' + u + '</a>' : url;
  });

  // Strip any remaining/unknown tags but keep their content
  s = s.replace(/\\[\\/?[a-z][a-z0-9=#,. \\-_'"\\/:]*\\]/gi, "");

  // Restore code blocks (escaped already)
  s = s.replace(/\\u0000CODE(\\d+)\\u0000/g, (_, i) => '<pre class="code">' + codes[Number(i)] + '</pre>');

  // Newlines → <br>
  s = s.replace(/\\n/g, "<br>");

  return s;
}

function render() {
  const feed = document.getElementById("feed");
  const frag = document.createDocumentFragment();
  for (const p of POSTS) {
    const art = document.createElement("article");
    const ts = new Date(Number(p.dateline) * 1000).toLocaleString();
    const url = "https://hackforums.net/showthread.php?pid=" + encodeURIComponent(p.pid);
    art.innerHTML =
      '<h2><a href="' + url + '" target="_blank" rel="noopener">' + escapeHtml(p.subject || "(no subject)") + '</a></h2>' +
      '<div class="ts">' + escapeHtml(ts) + '</div>' +
      '<div class="body">' + bbcode(p.message || "") + '</div>';
    frag.appendChild(art);
  }
  feed.appendChild(frag);
}
render();
</script>
</body>
</html>
`;

  fs.writeFileSync(OUT_FILE, html, "utf8");
  console.log(`Wrote ${OUT_FILE} (${posts.length} posts)`);
}

main();
