#!/usr/bin/env node
/**
 * Fetch all threads authored by uid=1 (ranf), filtered to fid=2, page by page.
 *
 * Usage:
 *   node scripts/fetch_ranf_threads.js --token <APIToken>
 *
 * Outputs:
 *   ranf-threads/threads.json   — accumulated fid=2 threads (deduped by tid)
 *   ranf-threads/.page_cursor   — highest page number whose results have been persisted
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const PROJECT_ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(PROJECT_ROOT, "ranf-threads");
const THREADS_FILE = path.join(OUT_DIR, "threads.json");
const CURSOR_FILE = path.join(OUT_DIR, ".page_cursor");

const UID = 1;
const PER_PAGE = 30;
const SLEEP_MS = 2000;

class RateLimitError extends Error {
  constructor(message) {
    super(message || "MAX_HOURLY_CALLS_EXCEEDED");
    this.name = "RateLimitError";
  }
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const part = argv[i];
    if (part.startsWith("--")) {
      const [key, value] = part.split("=");
      const k = key.replace(/^--/, "");
      if (value !== undefined) {
        args[k] = value;
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith("--")) {
          args[k] = next;
          i++;
        } else {
          args[k] = true;
        }
      }
    }
  }
  return args;
}

function postJson({ url, headers, body }) {
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
          ...(headers || {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          const status = res.statusCode || 0;
          if (status === 429) {
            reject(new RateLimitError(`HTTP 429: ${data || "<no body>"}`));
            return;
          }
          if (status >= 200 && status < 300) {
            try {
              resolve({ json: JSON.parse(data || "{}"), headers: res.headers });
            } catch (e) {
              reject(new Error(`Failed to parse JSON response: ${e.message}`));
            }
          } else {
            reject(new Error(`HTTP ${status}: ${data || "<no body>"}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(JSON.stringify(body || {}));
    req.end();
  });
}

async function fetchPage({ page, token }) {
  const url = "https://hackforums.net/api/v2/read/posts";
  const headers = {
    Authorization: `Bearer ${token}`,
    "Access-Token": token,
    "Content-Type": "application/json",
    "User-Agent": "PostmanRuntime/7.50.0",
  };
  const body = {
    asks: {
      threads: {
        _uid: UID,
        _page: page,
        _perpage: PER_PAGE,
        tid: true,
        uid: true,
        subject: true,
        dateline: true,
        fid: true,
        prefix: true,
      },
    },
  };
  const { json, headers: respHeaders } = await postJson({ url, headers, body });
  if (
    json &&
    json.success === false &&
    json.message === "MAX_HOURLY_CALLS_EXCEEDED"
  ) {
    throw new RateLimitError(json.message);
  }
  if (!json || !Array.isArray(json.threads)) {
    throw new Error("Unexpected API response shape (missing threads array)");
  }
  return {
    threads: json.threads,
    rateLimitRemaining: respHeaders["x-rate-limit-remaining"],
  };
}

function ensureDirSync(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readCursor() {
  try {
    const raw = fs.readFileSync(CURSOR_FILE, "utf8").trim();
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeCursor(page) {
  fs.writeFileSync(CURSOR_FILE, String(page), "utf8");
}

function readExistingThreads() {
  try {
    const raw = fs.readFileSync(THREADS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = parseArgs(process.argv);
  const token = args.token || args.t;
  if (!token) {
    console.error("Usage: node scripts/fetch_ranf_threads.js --token <APIToken>");
    process.exit(1);
  }

  ensureDirSync(OUT_DIR);

  const threads = readExistingThreads();
  const seen = new Set(threads.map((t) => t.tid));
  let cursor = readCursor();
  console.log(
    `Resuming from page ${cursor + 1} (existing threads: ${threads.length})`
  );

  let page = cursor + 1;
  while (true) {
    let result;
    try {
      result = await fetchPage({ page, token });
    } catch (err) {
      if (
        err &&
        (err.name === "RateLimitError" ||
          String(err.message).includes("MAX_HOURLY_CALLS_EXCEEDED"))
      ) {
        console.log(`Rate limit reached on page ${page}. Stopping.`);
        process.exit(1);
      }
      console.log(`Page ${page} - fetch failed: ${err.message}. Stopping.`);
      process.exit(1);
    }

    const { threads: fetched, rateLimitRemaining } = result;

    if (fetched.length === 0) {
      console.log(`Page ${page} - empty. No more threads. Stopping.`);
      break;
    }

    const matched = fetched.filter((t) => t.fid === "2");
    let kept = 0;
    for (const t of matched) {
      if (!seen.has(t.tid)) {
        seen.add(t.tid);
        threads.push(t);
        kept++;
      }
    }

    fs.writeFileSync(THREADS_FILE, JSON.stringify(threads, null, 2), "utf8");
    writeCursor(page);
    console.log(
      `page ${page} — fetched ${fetched.length}, kept ${kept} (fid=2), total ${threads.length}, x-rate-limit-remaining=${rateLimitRemaining}`
    );

    await sleep(SLEEP_MS);
    page++;
  }
}

if (require.main === module) {
  main();
}
