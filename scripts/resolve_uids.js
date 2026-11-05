#!/usr/bin/env node
/**
 * Resolve [mention=<uid>] tags in editions/<N>/posts.json to usernames via the HF API.
 *
 * Usage:
 *   node scripts/resolve_uids.js --start <N> --end <M> --token <APIToken> [--out <file>]
 *
 * Writes a JSON object { "<uid>": "<username>", ... } to --out
 * (default: <os temp dir>/hf_uidmap.json) and prints any uids the API did not return.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");

const PROJECT_ROOT = path.join(__dirname, "..");
const BATCH = 30;

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const part = argv[i];
    if (!part.startsWith("--")) continue;
    const [key, value] = part.split("=");
    const k = key.slice(2);
    if (value !== undefined) args[k] = value;
    else if (argv[i + 1] && !argv[i + 1].startsWith("--")) args[k] = argv[++i];
    else args[k] = true;
  }
  return args;
}

function postJson(url, token, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "Access-Token": token,
          "User-Agent": "PostmanRuntime/7.50.0",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data || "{}"));
            } catch (e) {
              reject(new Error(`Bad JSON: ${e.message}`));
            }
          } else reject(new Error(`HTTP ${res.statusCode}: ${data || "<no body>"}`));
        });
      }
    );
    req.on("error", reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const start = Number(args.start);
  const end = Number(args.end);
  const token = args.token;
  const out = args.out || path.join(os.tmpdir(), "hf_uidmap.json");
  if (!Number.isFinite(start) || !Number.isFinite(end) || !token) {
    console.error(
      "Usage: node scripts/resolve_uids.js --start <N> --end <M> --token <APIToken> [--out <file>]"
    );
    process.exit(1);
  }

  const uids = new Set();
  for (let n = start; n <= end; n++) {
    const f = path.join(PROJECT_ROOT, "editions", String(n), "posts.json");
    if (!fs.existsSync(f)) continue;
    const { posts } = JSON.parse(fs.readFileSync(f, "utf8"));
    for (const p of posts || []) {
      uids.add(String(p.uid));
      for (const m of String(p.message).matchAll(/\[mention=(\d+)\]/g)) uids.add(m[1]);
    }
  }
  const all = [...uids];
  console.log(`Resolving ${all.length} uid(s) from editions ${start}-${end}`);

  const map = {};
  for (let i = 0; i < all.length; i += BATCH) {
    const batch = all.slice(i, i + BATCH);
    const res = await postJson("https://hackforums.net/api/v2/read/users", token, {
      asks: { users: { _uid: batch, uid: true, username: true } },
    });
    if (res && res.success === false) {
      console.error(`API error: ${res.message}`);
      break;
    }
    let users = res && res.users;
    if (users && !Array.isArray(users)) users = [users]; // single match comes back as an object
    if (!Array.isArray(users)) {
      console.error(`Unexpected response: ${JSON.stringify(res).slice(0, 500)}`);
      break;
    }
    for (const u of users) map[String(u.uid)] = u.username;
  }

  fs.writeFileSync(out, JSON.stringify(map, null, 2), "utf8");
  const missing = all.filter((u) => !(u in map));
  console.log(`Wrote ${Object.keys(map).length} username(s) to ${out}`);
  if (missing.length) console.log(`Not returned by API: ${missing.join(", ")}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
