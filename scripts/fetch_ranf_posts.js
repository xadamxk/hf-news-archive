#!/usr/bin/env node
/**
 * Fetch the first post of each thread listed in ranf-threads/threads.json
 * and append to ranf-threads/posts.jsonl (one JSON post per line).
 *
 * Usage:
 *   node scripts/fetch_ranf_posts.js --token <APIToken>
 *
 * Idempotent: a tid already present in posts.jsonl is never refetched.
 * Resumable: append-only file is the state; rerun continues where the
 * previous run stopped (e.g. on rate limit).
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const PROJECT_ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(PROJECT_ROOT, "ranf-threads");
const THREADS_FILE = path.join(DATA_DIR, "threads.json");
const POSTS_FILE = path.join(DATA_DIR, "posts.jsonl");

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

async function fetchFirstPost({ tid, token }) {
  const url = "https://hackforums.net/api/v2/read/posts";
  const headers = {
    Authorization: `Bearer ${token}`,
    "Access-Token": token,
    "Content-Type": "application/json",
    "User-Agent": "PostmanRuntime/7.50.0",
  };
  const body = {
    asks: {
      posts: {
        _tid: [Number(tid)],
        _page: 1,
        _perpage: 1,
        pid: true,
        uid: true,
        dateline: true,
        message: true,
        subject: true,
        tid: true,
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
  if (!json || !Array.isArray(json.posts)) {
    throw new Error("Unexpected API response shape (missing posts array)");
  }
  return {
    posts: json.posts,
    rateLimitRemaining: respHeaders["x-rate-limit-remaining"],
  };
}

function readSeenTids() {
  const seen = new Set();
  if (!fs.existsSync(POSTS_FILE)) return seen;
  const raw = fs.readFileSync(POSTS_FILE, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj && obj.tid !== undefined) seen.add(String(obj.tid));
    } catch {
      // ignore malformed lines
    }
  }
  return seen;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = parseArgs(process.argv);
  const token = args.token || args.t;
  if (!token) {
    console.error("Usage: node scripts/fetch_ranf_posts.js --token <APIToken>");
    process.exit(1);
  }

  if (!fs.existsSync(THREADS_FILE)) {
    console.error(`Missing ${THREADS_FILE} — run fetch_ranf_threads.js first.`);
    process.exit(1);
  }

  const threads = JSON.parse(fs.readFileSync(THREADS_FILE, "utf8"));
  if (!Array.isArray(threads) || threads.length === 0) {
    console.error(`${THREADS_FILE} is empty.`);
    process.exit(1);
  }

  const seen = readSeenTids();
  console.log(
    `${threads.length} threads total; ${seen.size} already in posts.jsonl; ${
      threads.length - seen.size
    } to fetch.`
  );

  let total = seen.size;
  let fetched = 0;

  for (const thread of threads) {
    const tid = String(thread.tid);
    if (seen.has(tid)) continue;

    let result;
    try {
      result = await fetchFirstPost({ tid, token });
    } catch (err) {
      if (
        err &&
        (err.name === "RateLimitError" ||
          String(err.message).includes("MAX_HOURLY_CALLS_EXCEEDED"))
      ) {
        console.log(
          `Rate limit reached while fetching tid ${tid}. Stopping. Fetched ${fetched} this run.`
        );
        process.exit(1);
      }
      console.log(
        `tid ${tid} - fetch failed: ${err.message}. Stopping. Fetched ${fetched} this run.`
      );
      process.exit(1);
    }

    const { posts, rateLimitRemaining } = result;
    if (posts.length === 0) {
      console.log(`tid ${tid} - no posts returned, skipping`);
      await sleep(SLEEP_MS);
      continue;
    }

    const post = posts[0];
    fs.appendFileSync(POSTS_FILE, JSON.stringify(post) + "\n", "utf8");
    seen.add(tid);
    fetched++;
    total++;
    console.log(
      `tid ${tid} — fetched pid ${post.pid}, total ${total}, x-rate-limit-remaining=${rateLimitRemaining}`
    );

    await sleep(SLEEP_MS);
  }

  console.log(`Done. Fetched ${fetched} new post(s); total ${total}.`);
}

if (require.main === module) {
  main();
}
