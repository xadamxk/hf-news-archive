import {
  Fragment,
  memo,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  startTransition,
  useState,
} from "react";
import type { ReactNode } from "react";
import DatePicker from "react-datepicker";
import type {
  CompactEditionRow,
  CompactEvent,
  CompactUser,
  ContributorsPayload,
  EventsPayload,
  StatsPayload,
  StatsRow,
} from "./types";
import { PROFILE_BASE } from "./types";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type DateFilterMode = "off" | "before" | "after" | "between";

/** Bounds for year/month dropdowns in the date filter calendar. */
const DATE_FILTER_MIN = new Date(2000, 0, 1);
const DATE_FILTER_MAX = new Date(2040, 11, 31);

const PAGE_SIZE = 100;

/** HF News edition opener URL. Blog-sourced editions (where `b` is set) route
 *  to the blog page; post-sourced editions route to the showthread.php URL. */
function editionUrl(row: Pick<CompactEditionRow, "p" | "b">): string | null {
  if (row.b && row.b.trim()) {
    return `https://hackforums.net/blog/${encodeURIComponent(row.b.trim())}`;
  }
  if (row.p && row.p.trim()) {
    return `http://hackforums.net/showthread.php?pid=${encodeURIComponent(row.p.trim())}`;
  }
  return null;
}

const datePickerDropdownProps = {
  showMonthDropdown: true,
  showYearDropdown: true,
  dropdownMode: "select" as const,
  minDate: DATE_FILTER_MIN,
  maxDate: DATE_FILTER_MAX,
};

/** Category labels in the filter UI (data uses lowercase: news, interviews, …). */
function formatCategoryLabel(c: string): string {
  if (!c) return c;
  return c.charAt(0).toUpperCase() + c.slice(1);
}

function badgeClass(cat: string): string {
  const m: Record<string, string> = {
    site: "badge-site",
    users: "badge-users",
    groups: "badge-groups",
    threads: "badge-threads",
    news: "badge-news",
    interviews: "badge-interviews",
  };
  return `badge ${m[cat] ?? ""}`;
}

function formatDate(sec: number): string {
  try {
    return new Date(sec * 1000).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return String(sec);
  }
}

function isoDateTime(sec: number): string | undefined {
  try {
    return new Date(sec * 1000).toISOString();
  } catch {
    return undefined;
  }
}

/** Unix seconds at local midnight for yyyy-mm-dd, or null if invalid. */
function startOfLocalDaySec(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  const ms = new Date(y, mo - 1, d).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000);
}

/** First second strictly after the given local calendar day. */
function endOfLocalDayExclusiveSec(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  const ms = new Date(y, mo - 1, d + 1).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000);
}

function parseYmdToDate(ymd: string): Date | null {
  const s = startOfLocalDaySec(ymd);
  if (s === null) return null;
  return new Date(s * 1000);
}

function toYmdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shortLocaleDate(ymd: string): string {
  const dt = parseYmdToDate(ymd);
  if (!dt) return "";
  try {
    return dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return ymd;
  }
}

function dateFilterButtonSummary(mode: DateFilterMode, a: string, b: string): string {
  if (mode === "off") return "Any";
  if (mode === "before") return a ? `Before ${shortLocaleDate(a)}` : "Before…";
  if (mode === "after") return a ? `After ${shortLocaleDate(a)}` : "After…";
  if (a && b) return `${shortLocaleDate(a)} – ${shortLocaleDate(b)}`;
  return "Between…";
}

/** Descending bars + arrow down — newest first (largest time on top). */
function IconSortNewest() {
  return (
    <svg
      width={22}
      height={22}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 6h14M4 10h10M4 14h6" />
      <path d="M18 7v7M15 14l3 3 3-3" />
    </svg>
  );
}

/** Ascending bars + arrow up — oldest first. */
function IconSortOldest() {
  return (
    <svg
      width={22}
      height={22}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 6h6M4 10h10M4 14h14" />
      <path d="M18 17V10M15 10l3-3 3 3" />
    </svg>
  );
}

/**
 * Wrap each case-insensitive occurrence of `q` in <mark> (same substring rule as title/description filter).
 * `q` must already be trimmed + lowercased.
 */
function highlightSearchTerms(text: string, q: string): ReactNode {
  if (!q || !text) return text;
  const lower = text.toLowerCase();
  if (!lower.includes(q)) return text;
  const out: ReactNode[] = [];
  let start = 0;
  let key = 0;
  while (start < text.length) {
    const i = lower.indexOf(q, start);
    if (i < 0) {
      out.push(text.slice(start));
      break;
    }
    if (i > start) out.push(text.slice(start, i));
    out.push(
      <mark key={`sh-${key++}`} className="search-hit">
        {text.slice(i, i + q.length)}
      </mark>
    );
    start = i + q.length;
  }
  return <>{out}</>;
}

/** `q` is trimmed + lowercased; match UID string or username exactly (case-insensitive). */
function userMatchesUserFilter(u: CompactUser, q: string): boolean {
  if (!q) return false;
  if (u.i.toLowerCase() === q) return true;
  if (u.n && u.n.toLowerCase() === q) return true;
  return false;
}

/** Whether `ev` lists a user whose UID or username equals `uq` (trimmed + lowercased). */
function eventMatchesUserExact(ev: CompactEvent, uq: string): boolean {
  if (!uq) return true;
  const users = ev.u ?? [];
  return users.some((u) => userMatchesUserFilter(u, uq));
}

function UserLine({ u, userHighlight }: { u: CompactUser; userHighlight: string }) {
  const hasUid = u.i && u.i.length > 0;
  const hit = userMatchesUserFilter(u, userHighlight);
  const body = hasUid ? (
    <a href={`${PROFILE_BASE}${encodeURIComponent(u.i)}`} target="_blank" rel="noreferrer">
      {u.n || `(uid ${u.i})`}
    </a>
  ) : (
    <span>{u.n || "—"}</span>
  );
  return (
    <div className={`user-line${hit ? " user-line--filter-hit" : ""}`}>
      <span className="user-line-inner">
        {body}
        {u.r ? <span className="user-role"> — {u.r}</span> : null}
      </span>
    </div>
  );
}

/** Structural validation for aggregated events.json (no version field). */
function parseEventsPayload(data: unknown): EventsPayload {
  if (!data || typeof data !== "object") throw new Error("Invalid events payload");
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.ed)) throw new Error("Expected events.json with ed[] — run aggregate");
  if (!Array.isArray(d.a)) throw new Error("Invalid events payload");
  if (typeof d.n !== "number") throw new Error("Invalid events payload");
  const ed = d.ed as CompactEditionRow[];
  if (d.n !== d.a.length) throw new Error("Invalid events payload: n must match event count");
  for (const ev of d.a as CompactEvent[]) {
    if (!ev || typeof ev !== "object") throw new Error("Invalid events payload");
    const x = ev.x;
    if (typeof x !== "number" || !Number.isFinite(x) || x < 0 || x >= ed.length)
      throw new Error("Invalid events payload: bad edition index x");
  }
  return data as EventsPayload;
}

function eventStableKey(ev: CompactEvent, ed: CompactEditionRow[]): string {
  const row = ed[ev.x];
  const s = row?.s ?? ev.x;
  const e = row?.e ?? ev.x;
  /** Disambiguates rows that share edition + category + title (e.g. multiple Spotlight items). */
  const link = ev.l?.trim() ?? "";
  return `${s}:${e}:${ev.c}:${ev.t}:${link}`;
}

function PaginationBar({
  variant,
  pageClamped,
  totalPages,
  onPrev,
  onNext,
}: {
  variant: "top" | "bottom";
  pageClamped: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const atStart = pageClamped <= 0;
  const atEnd = pageClamped >= totalPages - 1;
  return (
    <nav
      className={`pagination-bar${variant === "bottom" ? " pagination-bar--bottom" : ""}`}
      aria-label={variant === "bottom" ? "Results pages, end of list" : "Results pages"}
    >
      <button
        type="button"
        className="btn-text pagination-btn"
        disabled={atStart}
        aria-disabled={atStart}
        aria-label="Previous page"
        onClick={() => startTransition(onPrev)}
      >
        Previous
      </button>
      <span className="pagination-summary" aria-live="polite">
        Page {pageClamped + 1} of {totalPages}
      </span>
      <button
        type="button"
        className="btn-text pagination-btn"
        disabled={atEnd}
        aria-disabled={atEnd}
        aria-label="Next page"
        onClick={() => startTransition(onNext)}
      >
        Next
      </button>
    </nav>
  );
}

const EventCard = memo(function EventCard({
  ev,
  edition,
  userHighlight,
  searchHighlight,
}: {
  ev: CompactEvent;
  edition: CompactEditionRow | undefined;
  userHighlight: string;
  searchHighlight: string;
}) {
  const sec = edition?.s ?? 0;
  const iso = useMemo(() => isoDateTime(sec), [sec]);
  const displayDate = useMemo(() => (edition ? formatDate(sec) : "—"), [edition, sec]);
  const titleNodes = useMemo(
    () => highlightSearchTerms(ev.t, searchHighlight),
    [ev.t, searchHighlight]
  );
  const descNodes = useMemo(
    () => (ev.d ? highlightSearchTerms(ev.d, searchHighlight) : null),
    [ev.d, searchHighlight]
  );
  return (
    <article className="card">
      <div className="post-top">
        <div className="post-main">
          <h2 className="card-title">
            {ev.l ? (
              <a className="card-title-link" href={ev.l} target="_blank" rel="noreferrer">
                {titleNodes}
              </a>
            ) : (
              titleNodes
            )}
          </h2>
          <p className="post-meta">
            <span className="post-meta-strong">
              {edition != null ? (() => {
                const href = editionUrl(edition);
                return href ? (
                  <a
                    className="post-meta-edition-link"
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Edition {edition.e}
                  </a>
                ) : (
                  <>Edition {edition.e}</>
                );
              })() : (
                <>Edition ?</>
              )}
            </span>
            <span className="post-meta-sep" aria-hidden="true">
              {" "}
              ·{" "}
            </span>
            {iso ? (
              <time dateTime={iso} className="post-meta-time">
                {displayDate}
              </time>
            ) : (
              <span>{displayDate}</span>
            )}
          </p>
        </div>
        <span className={badgeClass(ev.c)}>{ev.c}</span>
      </div>
      {ev.d ? <p className="card-desc">{descNodes}</p> : null}
      {ev.u?.length ? (
        <div className="card-row card-row-users">
          <strong>Users</strong>
          <div className="user-list">
            {ev.u.map((u, i) => (
              <UserLine key={`${u.i}-${u.n}-${i}`} u={u} userHighlight={userHighlight} />
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
});

type SortOrder = "newest" | "oldest";

type TabKey = "events" | "contributors" | "stats";

/** Configuration for each chart in the small-multiples grid. */
type SiteStatChart = {
  /** dataKey passed to Recharts — must match a field on the enriched chart row. */
  key: string;
  label: string;
  /** Stroke color for the line (HF blue palette where possible). */
  color: string;
};

const SITE_TOTAL_CHARTS: SiteStatChart[] = [
  { key: "tp", label: "Total Posts", color: "#499FED" },
  { key: "tt", label: "Total Threads", color: "#32CD32" },
  { key: "tm", label: "Total Members", color: "#FFD700" },
];

const SITE_GROWTH_CHARTS: SiteStatChart[] = [
  { key: "posts_added", label: "Posts Added (since last edition)", color: "#499FED" },
  { key: "threads_added", label: "Threads Added (since last edition)", color: "#32CD32" },
  { key: "members_added", label: "Members Added (since last edition)", color: "#FFD700" },
];

/** Format big numbers compactly for the chart Y axis (45M, 13K, etc.). */
function compactNumber(n: number): string {
  if (n == null || !Number.isFinite(n)) return "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** Format a value in tooltips with thousands separators. */
function fullNumber(n: number): string {
  if (n == null || !Number.isFinite(n)) return "";
  return Number.isInteger(n)
    ? n.toLocaleString()
    : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** Short X-axis tick: "Jan '17" — keeps room for many editions horizontally. */
function shortMonthYear(ms: number): string {
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const mon = d.toLocaleDateString(undefined, { month: "short" });
  const yr = String(d.getFullYear()).slice(-2);
  return `${mon} '${yr}`;
}

/** Full date for tooltips: "Aug 22, 2017". */
function fullDate(ms: number): string {
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Enriched stat row: original cumulative fields plus dateMs (for the X axis)
 *  and the derived posts_added / threads_added / members_added growth fields.
 *
 *  Growth fields are CLAMPED to 0 (negative deltas occur when accounts are
 *  purged — not real "negative growth"). The raw signed value is preserved
 *  in `*_raw` for tooltip transparency. */
type EnrichedStatsRow = StatsRow & {
  e: number;
  dateMs?: number;
  posts_added?: number;
  posts_added_raw?: number;
  threads_added?: number;
  threads_added_raw?: number;
  members_added?: number;
  members_added_raw?: number;
};

/** Quantile (0..1) of a numeric array; nearest-rank method (no interpolation). */
function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
  return sorted[idx];
}

/** Compute a Y-axis cap that hides extreme outliers without losing the data
 *  points. Returns null if the dataset has no meaningful outliers (the chart
 *  can then use its natural max). Heuristic: if max > 3 × p95, cap at p95;
 *  otherwise no cap. */
function computeSoftCap(values: number[]): number | null {
  if (values.length < 8) return null; // too small to identify outliers reliably
  const sorted = [...values].sort((a, b) => a - b);
  const p95 = quantile(sorted, 0.95);
  const max = sorted[sorted.length - 1];
  if (p95 == null || max == null) return null;
  if (max <= p95 * 3) return null;
  // Cap above p95 so typical "high but not extreme" weeks aren't clipped.
  return Math.ceil(p95 * 1.5);
}

type GapMarker = { atMs: number; days: number; label: string };

function StatChartCard({
  config,
  data,
  gapMarkers,
}: {
  config: SiteStatChart;
  data: EnrichedStatsRow[];
  gapMarkers: GapMarker[];
}) {
  // Build the series — drop any editions where this metric or the dateMs is missing.
  const series = data.filter(
    (r) =>
      (r as Record<string, unknown>)[config.key] != null &&
      r.dateMs != null,
  );

  // Per-chart cap so an outlier like ed 456's +20M posts doesn't squash the
  // rest of the timeline to a flat line. Values above the cap are rendered
  // at the cap line with a labelled dot showing the actual figure.
  const values = series
    .map((r) => (r as Record<string, unknown>)[config.key] as number | undefined)
    .filter((v): v is number => v != null);
  const cap = computeSoftCap(values);

  // The raw-value key (e.g. `posts_added_raw`) carries the signed pre-clamp
  // figure for tooltip transparency.
  const rawKey = `${config.key}_raw`;

  // Display-value key — same as config.key when no cap, otherwise a clamped
  // version stitched into each row.
  const seriesWithDisplay = cap != null
    ? series.map((r) => ({
        ...r,
        [`${config.key}_display`]: Math.min(
          (r as Record<string, number | undefined>)[config.key] ?? 0,
          cap,
        ),
      }))
    : series;
  const displayKey = cap != null ? `${config.key}_display` : config.key;
  const yDomain: [number, number | string] = cap != null
    ? [0, cap]
    : [0, "auto"];

  return (
    <div className="stat-chart-card">
      <h3 className="stat-chart-title">{config.label}</h3>
      <div className="stat-chart-figure">
        <ResponsiveContainer width="100%" height={320}>
          <LineChart
            data={seriesWithDisplay}
            margin={{ top: 16, right: 16, bottom: 4, left: 4 }}
          >
            <CartesianGrid stroke="#1d1d1d" strokeDasharray="3 3" />
            <XAxis
              dataKey="dateMs"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tick={{ fill: "#c3c3c3", fontSize: 11 }}
              stroke="#1d1d1d"
              tickFormatter={shortMonthYear}
            />
            <YAxis
              tick={{ fill: "#c3c3c3", fontSize: 11 }}
              stroke="#1d1d1d"
              tickFormatter={compactNumber}
              width={56}
              domain={yDomain}
              allowDataOverflow={cap != null}
            />
            <Tooltip
              contentStyle={{
                background: "#333",
                border: "1px solid #1d1d1d",
                color: "#efefef",
                fontSize: 13,
              }}
              labelStyle={{ color: "#499FED", fontWeight: 600 }}
              labelFormatter={(_v, payload) => {
                const p = Array.isArray(payload) && payload.length > 0
                  ? (payload[0].payload as StatsRow & { dateMs?: number })
                  : null;
                if (!p) return "";
                const e = p.e;
                const ms = p.dateMs;
                return `Edition ${e}${ms != null ? ` — ${fullDate(ms)}` : ""}`;
              }}
              formatter={(_displayValue: number, _name, item) => {
                // Show the actual (un-clamped) value; flag if the raw was
                // negative (a purge) so the user knows the chart's 0 isn't
                // a literal zero-growth week.
                const payload = item.payload as Record<string, number | undefined>;
                const actual = payload[config.key];
                const raw = payload[rawKey];
                const aboveCap = cap != null && actual != null && actual > cap;
                const wasNegative = raw != null && raw < 0;
                const display = actual != null ? fullNumber(actual) : "";
                const note = wasNegative
                  ? ` (raw ${fullNumber(raw as number)} — account purge clamped to 0)`
                  : aboveCap
                    ? " (above visible range)"
                    : "";
                return [`${display}${note}`, config.label];
              }}
            />
            {/* Vertical dashed lines marking publishing gaps > 90 days. */}
            {gapMarkers.map((g, i) => (
              <ReferenceLine
                key={`gap-${i}`}
                x={g.atMs}
                stroke="#ff79c6"
                strokeDasharray="4 4"
                strokeOpacity={0.6}
                label={{
                  value: g.label,
                  position: "top",
                  fill: "#ff79c6",
                  fontSize: 10,
                }}
                ifOverflow="extendDomain"
              />
            ))}
            <Line
              type="monotone"
              dataKey={displayKey}
              stroke={config.color}
              strokeWidth={2}
              dot={cap != null
                ? renderClampedDot(config.key, cap, config.color)
                : false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Custom dot renderer: only draws a dot when the original value was clamped
 *  by the soft cap. Renders a hollow circle in the line color with a label
 *  above showing the actual figure, so outliers are clearly visible without
 *  inflating the Y-axis. Other points get no dot (cleaner chart). */
function renderClampedDot(
  fieldKey: string,
  cap: number,
  color: string,
) {
  type DotProps = {
    cx?: number;
    cy?: number;
    payload?: Record<string, number | undefined>;
    index?: number;
  };
  return (props: DotProps) => {
    const { cx, cy, payload } = props;
    if (cx == null || cy == null || !payload) return <g />;
    const actual = payload[fieldKey];
    if (actual == null || actual <= cap) return <g />;
    return (
      <g>
        <circle
          cx={cx}
          cy={cy}
          r={5}
          fill="#1a1a1a"
          stroke={color}
          strokeWidth={2}
        />
        <text
          x={cx}
          y={cy - 9}
          textAnchor="middle"
          fontSize={10}
          fill={color}
          fontWeight={600}
        >
          {compactNumber(actual)}
        </text>
      </g>
    );
  };
}

function StatisticsPanel({ editions }: { editions: CompactEditionRow[] }) {
  const [data, setData] = useState<StatsPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [minEdition, setMinEdition] = useState<string>("");
  const [maxEdition, setMaxEdition] = useState<string>("");

  /** Map edition number → unix-ms timestamp for the chart X axis. */
  const editionDateMs = useMemo(() => {
    const m = new Map<number, number>();
    for (const ed of editions) {
      if (typeof ed.e === "number" && typeof ed.s === "number") {
        m.set(ed.e, ed.s * 1000);
      }
    }
    return m;
  }, [editions]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${import.meta.env.BASE_URL}stats.json`, { cache: "no-cache" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j: StatsPayload) => {
        if (!cancelled) setData(j);
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dataRange = useMemo(() => {
    if (!data || data.s.length === 0) return { min: 0, max: 0 };
    const nums = data.s.map((r) => r.e);
    return { min: Math.min(...nums), max: Math.max(...nums) };
  }, [data]);

  /** Sort the full dataset by edition number, attach dateMs for the X axis,
   *  and derive growth-between-editions deltas (posts/threads/members added
   *  since the closest previous edition that had a value for that field).
   *  Deltas are computed on the FULL dataset before filtering so the first
   *  edition in any range still has a delta relative to its true predecessor,
   *  not a misleading 0. */
  const allRowsWithGrowth = useMemo<EnrichedStatsRow[]>(() => {
    if (!data) return [];
    const sorted = [...data.s].sort((a, b) => a.e - b.e);
    let prevTp: number | undefined;
    let prevTt: number | undefined;
    let prevTm: number | undefined;
    return sorted.map((r) => {
      const enriched: EnrichedStatsRow = {
        ...r,
        dateMs: editionDateMs.get(r.e),
      };
      if (r.tp != null && prevTp != null) {
        const raw = r.tp - prevTp;
        enriched.posts_added_raw = raw;
        enriched.posts_added = Math.max(0, raw);
      }
      if (r.tt != null && prevTt != null) {
        const raw = r.tt - prevTt;
        enriched.threads_added_raw = raw;
        enriched.threads_added = Math.max(0, raw);
      }
      if (r.tm != null && prevTm != null) {
        const raw = r.tm - prevTm;
        enriched.members_added_raw = raw;
        enriched.members_added = Math.max(0, raw);
      }
      if (r.tp != null) prevTp = r.tp;
      if (r.tt != null) prevTt = r.tt;
      if (r.tm != null) prevTm = r.tm;
      return enriched;
    });
  }, [data, editionDateMs]);

  const filteredRows = useMemo(() => {
    const minN = minEdition === "" ? -Infinity : Number(minEdition);
    const maxN = maxEdition === "" ? Infinity : Number(maxEdition);
    return allRowsWithGrowth.filter((r) => r.e >= minN && r.e <= maxN);
  }, [allRowsWithGrowth, minEdition, maxEdition]);

  /** Publishing gaps longer than 90 days inside the filtered range. Surfaced
   *  as vertical dashed reference lines on each chart so the user can see
   *  that the timeline is non-uniform — a large spike right after a gap
   *  represents months of growth, not a single week. */
  const gapMarkers = useMemo(() => {
    const out: { atMs: number; days: number; label: string }[] = [];
    let prev: EnrichedStatsRow | null = null;
    for (const r of filteredRows) {
      if (prev && prev.dateMs != null && r.dateMs != null) {
        const days = (r.dateMs - prev.dateMs) / 86400000;
        if (days > 90) {
          const months = Math.round(days / 30);
          out.push({
            atMs: (prev.dateMs + r.dateMs) / 2,
            days,
            label: months >= 12 ? `~${(months / 12).toFixed(1)}y gap` : `~${months}mo gap`,
          });
        }
      }
      prev = r;
    }
    return out;
  }, [filteredRows]);

  if (err) {
    return (
      <div id="panel-stats" role="tabpanel" className="stats-panel">
        <p className="error">Failed to load stats: {err}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div id="panel-stats" role="tabpanel" className="stats-panel">
        <p className="loading">Loading statistics…</p>
      </div>
    );
  }

  return (
    <div id="panel-stats" role="tabpanel" className="stats-panel">
      <p className="meta" style={{ marginTop: 0 }}>
        {data.n} editions with stats captured (editions {dataRange.min} –
        {" "}{dataRange.max}). Filter the range below; charts redraw
        automatically.
      </p>

      <div className="stats-filter">
        <label className="stats-filter-cell">
          <span className="filter-heading">From edition</span>
          <input
            type="number"
            inputMode="numeric"
            className="filter-input"
            placeholder={String(dataRange.min)}
            value={minEdition}
            onChange={(e) => setMinEdition(e.target.value)}
            min={dataRange.min}
            max={dataRange.max}
          />
        </label>
        <label className="stats-filter-cell">
          <span className="filter-heading">To edition</span>
          <input
            type="number"
            inputMode="numeric"
            className="filter-input"
            placeholder={String(dataRange.max)}
            value={maxEdition}
            onChange={(e) => setMaxEdition(e.target.value)}
            min={dataRange.min}
            max={dataRange.max}
          />
        </label>
        {(minEdition || maxEdition) && (
          <button
            type="button"
            className="stats-filter-reset"
            onClick={() => {
              setMinEdition("");
              setMaxEdition("");
            }}
          >
            Reset
          </button>
        )}
        <span className="stats-filter-count">
          {filteredRows.length} edition{filteredRows.length === 1 ? "" : "s"}{" "}
          in range
        </span>
      </div>

      <section className="stats-section">
        <h2 className="stats-section-title">Site Statistics — Cumulative Totals</h2>
        <div className="stat-chart-grid">
          {SITE_TOTAL_CHARTS.map((c) => (
            <StatChartCard key={c.key} config={c} data={filteredRows} gapMarkers={gapMarkers} />
          ))}
        </div>
      </section>

      <section className="stats-section">
        <h2 className="stats-section-title">Site Statistics — Growth Between Editions</h2>
        <p className="meta" style={{ marginTop: "-0.4rem", marginBottom: "0.6rem" }}>
          Posts / threads / members added between each edition and the previous
          one carrying that field. Long publishing gaps show as taller bars
          because they represent more elapsed activity, not a sudden spike.
        </p>
        <div className="stat-chart-grid">
          {SITE_GROWTH_CHARTS.map((c) => (
            <StatChartCard key={c.key} config={c} data={filteredRows} gapMarkers={gapMarkers} />
          ))}
        </div>
      </section>
    </div>
  );
}

function ContributorsPanel({ editions }: { editions: CompactEditionRow[] }) {
  const [data, setData] = useState<ContributorsPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  /** Set of uids whose editions row is currently expanded. Multiple rows can
   *  be expanded in parallel. */
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    fetch(`${import.meta.env.BASE_URL}contributors.json`, { cache: "no-cache" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j: ContributorsPayload) => {
        if (!cancelled) setData(j);
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Edition number → compact row lookup, used by the expanded pill links to
   *  build thread vs blog URLs. */
  const editionByNumber = useMemo(() => {
    const m = new Map<number, CompactEditionRow>();
    for (const e of editions) m.set(e.e, e);
    return m;
  }, [editions]);

  function toggle(uid: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }

  if (err) {
    return (
      <div id="panel-contributors" role="tabpanel" className="contributors-panel">
        <p className="error">Failed to load contributors: {err}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div id="panel-contributors" role="tabpanel" className="contributors-panel">
        <p className="loading">Loading contributors…</p>
      </div>
    );
  }

  return (
    <div id="panel-contributors" role="tabpanel" className="contributors-panel">
      <p className="meta" style={{ marginTop: 0 }}>
        {data.n} contributors across HF News editions, sorted by editions
        contributed to.
      </p>
      <div className="contributors-table-wrap">
        <table className="contributors-table">
          <thead>
            <tr>
              <th scope="col" className="col-editions">Contributed Editions</th>
              <th scope="col" className="col-username">Username</th>
              <th scope="col" className="col-roles">Roles</th>
              <th scope="col" className="col-expand" aria-label="Show editions" />
            </tr>
          </thead>
          <tbody>
            {data.c.map((row) => {
              const isOpen = expanded.has(row.i);
              const eds = row.eds ?? [];
              return (
                <Fragment key={row.i}>
                  <tr>
                    <td className="col-editions">{row.e}</td>
                    <td className="col-username">
                      <a
                        href={`${PROFILE_BASE}${encodeURIComponent(row.i)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {row.u}
                      </a>
                    </td>
                    <td className="col-roles">
                      {(row.r ?? []).join(", ")}
                    </td>
                    <td className="col-expand">
                      <button
                        type="button"
                        className={`expand-btn${isOpen ? " is-open" : ""}`}
                        aria-expanded={isOpen}
                        aria-label={isOpen ? `Hide editions for ${row.u}` : `Show editions for ${row.u}`}
                        onClick={() => toggle(row.i)}
                        disabled={eds.length === 0}
                      >
                        <span aria-hidden="true">▸</span>
                      </button>
                    </td>
                  </tr>
                  {isOpen && eds.length > 0 ? (
                    <tr className="expanded-row">
                      <td colSpan={4}>
                        <div className="edition-pills">
                          {eds.map((edNum) => {
                            const er = editionByNumber.get(edNum);
                            const href = er ? editionUrl(er) : null;
                            const cls = er?.b ? "edition-pill is-blog" : "edition-pill";
                            return href ? (
                              <a
                                key={edNum}
                                className={cls}
                                href={href}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {edNum}
                              </a>
                            ) : (
                              <span key={edNum} className={`${cls} is-orphan`}>
                                {edNum}
                              </span>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function App() {
  const [raw, setRaw] = useState<EventsPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("events");
  const [q, setQ] = useState("");
  const [selectedCats, setSelectedCats] = useState<Set<string>>(() => new Set());
  const [catMenuOpen, setCatMenuOpen] = useState(false);
  const catDropdownRef = useRef<HTMLDivElement>(null);
  const [dateFilterOpen, setDateFilterOpen] = useState(false);
  const dateFilterRef = useRef<HTMLDivElement>(null);
  const [userQ, setUserQ] = useState("");
  const [dateFilterMode, setDateFilterMode] = useState<DateFilterMode>("off");
  const [dateFilterA, setDateFilterA] = useState("");
  const [dateFilterB, setDateFilterB] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [page, setPage] = useState(0);
  const prevPageClampedRef = useRef<number | null>(null);

  const selectedCatsSignature = useMemo(
    () => [...selectedCats].sort().join(","),
    [selectedCats],
  );

  const selectedCategoryLabels = useMemo(
    () => [...selectedCats].sort().map(formatCategoryLabel),
    [selectedCats],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}events.json`);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const json = await res.json();
        if (!cancelled) setRaw(parseEventsPayload(json));
      } catch (e) {
        if (!cancelled)
          setErr(e instanceof Error ? e.message : "Failed to load events.json");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const deferredQ = useDeferredValue(q);
  const deferredUserQ = useDeferredValue(userQ);

  const categories = useMemo(() => {
    if (!raw) return [] as string[];
    const s = new Set<string>();
    for (const ev of raw.a) s.add(ev.c);
    return [...s].sort();
  }, [raw]);

  /** Highest edition number in the archive (tie-break by newer edition row timestamp). */
  const latestEditionHeadline = useMemo(() => {
    if (!raw?.ed.length) return null;
    let best: CompactEditionRow | null = null;
    for (const row of raw.ed) {
      if (
        !best ||
        row.e > best.e ||
        (row.e === best.e && row.s > best.s)
      )
        best = row;
    }
    return best ? { edition: String(best.e), dateSec: best.s } : null;
  }, [raw]);

  const filtered = useMemo(() => {
    if (!raw) return [];
    const ed = raw.ed;
    const qq = deferredQ.trim().toLowerCase();
    const uq = deferredUserQ.trim().toLowerCase();
    return raw.a.filter((ev) => {
      const sec = ed[ev.x]?.s ?? 0;
      if (selectedCats.size > 0 && !selectedCats.has(ev.c)) return false;
      if (qq) {
        const blob = `${ev.t} ${ev.d ?? ""}`.toLowerCase();
        if (!blob.includes(qq)) return false;
      }
      if (uq && !eventMatchesUserExact(ev, uq)) return false;
      if (dateFilterMode === "before") {
        const lim = startOfLocalDaySec(dateFilterA);
        if (lim !== null && !(sec < lim)) return false;
      } else if (dateFilterMode === "after") {
        const lim = endOfLocalDayExclusiveSec(dateFilterA);
        if (lim !== null && !(sec >= lim)) return false;
      } else if (dateFilterMode === "between") {
        const a = dateFilterA.trim();
        const b = dateFilterB.trim();
        if (a && b) {
          const dLo = a <= b ? a : b;
          const dHi = a <= b ? b : a;
          const t0 = startOfLocalDaySec(dLo);
          const t1 = endOfLocalDayExclusiveSec(dHi);
          if (t0 !== null && t1 !== null && !(sec >= t0 && sec < t1)) return false;
        }
      }
      return true;
    });
  }, [raw, deferredQ, deferredUserQ, selectedCats, dateFilterMode, dateFilterA, dateFilterB]);

  const displayEvents = useMemo(() => {
    if (!raw) return [];
    const ed = raw.ed;
    const arr = [...filtered];
    arr.sort((a, b) => {
      const sa = ed[a.x]?.s ?? 0;
      const sb = ed[b.x]?.s ?? 0;
      const cmpS = sa - sb;
      if (cmpS !== 0) return sortOrder === "newest" ? -cmpS : cmpS;
      const ea = ed[a.x]?.e ?? 0;
      const eb = ed[b.x]?.e ?? 0;
      const cmpE = ea - eb;
      return sortOrder === "newest" ? -cmpE : cmpE;
    });
    return arr;
  }, [raw, filtered, sortOrder]);

  useEffect(() => {
    setPage(0);
  }, [
    deferredQ,
    deferredUserQ,
    selectedCatsSignature,
    dateFilterMode,
    dateFilterA,
    dateFilterB,
    sortOrder,
  ]);

  const totalFiltered = displayEvents.length;
  const totalPages =
    totalFiltered === 0 ? 1 : Math.ceil(totalFiltered / PAGE_SIZE);
  const pageClamped = Math.min(page, Math.max(0, totalPages - 1));
  const visibleEvents = useMemo(() => {
    const start = pageClamped * PAGE_SIZE;
    return displayEvents.slice(start, start + PAGE_SIZE);
  }, [displayEvents, pageClamped]);

  useEffect(() => {
    if (prevPageClampedRef.current === null) {
      prevPageClampedRef.current = pageClamped;
      return;
    }
    if (prevPageClampedRef.current !== pageClamped) {
      prevPageClampedRef.current = pageClamped;
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [pageClamped]);

  const showPagination =
    totalFiltered > 0 && totalFiltered > PAGE_SIZE;
  const rangeStart = totalFiltered === 0 ? 0 : pageClamped * PAGE_SIZE + 1;
  const rangeEnd = Math.min(totalFiltered, (pageClamped + 1) * PAGE_SIZE);

  /** Normalized user filter for highlighting (matches deferred filter used in the list). */
  const userHighlight = useMemo(() => deferredUserQ.trim().toLowerCase(), [deferredUserQ]);

  /** Normalized title/description search for <mark> highlights (matches deferred filter). */
  const searchHighlight = useMemo(() => deferredQ.trim().toLowerCase(), [deferredQ]);

  function toggleCategory(c: string) {
    setSelectedCats((prev) => {
      const n = new Set(prev);
      if (n.has(c)) n.delete(c);
      else n.add(c);
      return n;
    });
  }

  useEffect(() => {
    if (!catMenuOpen && !dateFilterOpen) return;
    /** Use mousedown (not pointerdown) so we do not unmount the calendar before react-datepicker receives the click. */
    function onMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (catMenuOpen && catDropdownRef.current && !catDropdownRef.current.contains(t)) {
        setCatMenuOpen(false);
      }
      if (dateFilterOpen && dateFilterRef.current && !dateFilterRef.current.contains(t)) {
        setDateFilterOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setCatMenuOpen(false);
        setDateFilterOpen(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [catMenuOpen, dateFilterOpen]);

  if (err) {
    return (
      <div className="error">
        <strong>Could not load data.</strong> {err}
        <p className="meta" style={{ marginTop: "0.75rem" }}>
          Run <code>bun run scripts/aggregate.ts</code> from the <code>viewer</code> folder (or see
          README), then refresh. For production build, run <code>bun run build</code> which regenerates{" "}
          <code>public/events.json</code> first.
        </p>
      </div>
    );
  }

  if (!raw) {
    return <div className="loading">Loading events…</div>;
  }

  return (
    <>
      <header style={{ marginBottom: "1.25rem" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: "0 0 0.35rem" }}>
          HF News Archive
        </h1>
        <p className="meta" style={{ margin: 0 }}>
          {latestEditionHeadline ? (
            <>
              Latest Edition {latestEditionHeadline.edition} ({formatDate(latestEditionHeadline.dateSec)})
            </>
          ) : null}
        </p>
      </header>

      <nav className="shadetabs" aria-label="Primary">
        <ul role="tablist">
          {([
            { key: "events", label: "Events" },
            { key: "contributors", label: "Contributors" },
            { key: "stats", label: "Statistics" },
          ] as const).map((tab) => (
            <li key={tab.key}>
              <a
                href={`#${tab.key}`}
                role="tab"
                aria-selected={activeTab === tab.key}
                aria-controls={`panel-${tab.key}`}
                className={activeTab === tab.key ? "selected" : ""}
                onClick={(e) => {
                  e.preventDefault();
                  setActiveTab(tab.key);
                }}
              >
                {tab.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {activeTab === "events" ? (
        <div id="panel-events" role="tabpanel" aria-labelledby="tab-events">

      <section className="toolbar" aria-label="Search and filters">
        <div className="filter-grid">
          <div className="filter-cell filter-cell--search">
            <label className="filter-heading" htmlFor="filter-input-search">
              Search title / description
            </label>
            <input
              id="filter-input-search"
              className="filter-input"
              type="search"
              placeholder="e.g. Omniscient, ban, MOTM…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="filter-cell filter-cell--user">
            <label className="filter-heading" htmlFor="filter-input-user">
              User (Name or UID)
            </label>
            <input
              id="filter-input-user"
              className="filter-input"
              type="text"
              placeholder="exact username or uid"
              value={userQ}
              onChange={(e) => setUserQ(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="filter-cell filter-cell--date">
              <span className="filter-heading" id="date-filter-label">
                Date
              </span>
              <div className="cat-dropdown-anchor" ref={dateFilterRef}>
                <button
                  type="button"
                  className="cat-dropdown-trigger"
                  aria-labelledby="date-filter-label date-filter-value"
                  aria-expanded={dateFilterOpen}
                  aria-haspopup="dialog"
                  onClick={() => {
                    setDateFilterOpen((o) => !o);
                    setCatMenuOpen(false);
                  }}
                >
                  <span id="date-filter-value" className="cat-dropdown-value">
                    {dateFilterButtonSummary(dateFilterMode, dateFilterA, dateFilterB)}
                  </span>
                  <span className={`cat-chevron${dateFilterOpen ? " cat-chevron-open" : ""}`} aria-hidden>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </button>
                {dateFilterOpen ? (
                  <div className="date-filter-panel" role="dialog" aria-labelledby="date-filter-label">
                    <select
                      className="date-filter-mode"
                      value={dateFilterMode}
                      aria-label="Date filter mode"
                      onChange={(e) => {
                        const m = e.target.value as DateFilterMode;
                        setDateFilterMode(m);
                        if (m === "off") {
                          setDateFilterA("");
                          setDateFilterB("");
                        }
                      }}
                    >
                      <option value="off">Any date</option>
                      <option value="before">Before</option>
                      <option value="after">After</option>
                      <option value="between">Between</option>
                    </select>
                    {dateFilterMode === "off" ? (
                      <p className="category-hint" style={{ margin: 0 }}>
                        Choose a mode, then pick day(s) on the calendar.
                      </p>
                    ) : dateFilterMode === "between" ? (
                      <div className="date-filter-calendar-wrap">
                        <DatePicker
                          inline
                          selectsRange
                          shouldCloseOnSelect={false}
                          openToDate={parseYmdToDate(dateFilterA) ?? parseYmdToDate(dateFilterB) ?? new Date()}
                          startDate={dateFilterA ? parseYmdToDate(dateFilterA) : null}
                          endDate={dateFilterB ? parseYmdToDate(dateFilterB) : null}
                          onChange={(dates) => {
                            const [s, e] = dates as [Date | null, Date | null];
                            setDateFilterA(s ? toYmdLocal(s) : "");
                            setDateFilterB(e ? toYmdLocal(e) : "");
                          }}
                          calendarClassName="hf-datepicker-calendar"
                          {...datePickerDropdownProps}
                        />
                      </div>
                    ) : (
                      <div className="date-filter-calendar-wrap">
                        <DatePicker
                          inline
                          shouldCloseOnSelect={false}
                          openToDate={parseYmdToDate(dateFilterA) ?? new Date()}
                          selected={dateFilterA ? parseYmdToDate(dateFilterA) : null}
                          onChange={(d: Date | null) => {
                            setDateFilterA(d ? toYmdLocal(d) : "");
                          }}
                          calendarClassName="hf-datepicker-calendar"
                          {...datePickerDropdownProps}
                        />
                      </div>
                    )}
                    <button
                      type="button"
                      className="btn-text date-filter-clear"
                      onClick={() => {
                        setDateFilterMode("off");
                        setDateFilterA("");
                        setDateFilterB("");
                      }}
                    >
                      Clear date filter
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          <div className="filter-cell filter-cell--cat">
            <span className="filter-heading" id="cat-dropdown-label">
              Categories
            </span>
            <div className="cat-dropdown-anchor" ref={catDropdownRef}>
              <button
                type="button"
                className="cat-dropdown-trigger"
                aria-labelledby="cat-dropdown-label cat-dropdown-value"
                aria-expanded={catMenuOpen}
                aria-haspopup="listbox"
                onClick={() => {
                  setCatMenuOpen((o) => !o);
                  setDateFilterOpen(false);
                }}
              >
                <span id="cat-dropdown-value" className="cat-dropdown-value">
                  {selectedCats.size === 0
                    ? "All categories"
                    : selectedCategoryLabels.join(", ")}
                </span>
                <span className={`cat-chevron${catMenuOpen ? " cat-chevron-open" : ""}`} aria-hidden>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </button>
              {catMenuOpen ? (
                <div className="cat-dropdown-panel">
                  <p className="category-hint" id="cat-dropdown-hint">
                    Choose none for all events, or several categories (combined with OR).
                  </p>
                  <ul
                    className="cat-dropdown-list"
                    role="listbox"
                    aria-labelledby="cat-dropdown-label"
                    aria-describedby="cat-dropdown-hint"
                    aria-multiselectable="true"
                  >
                    {categories.map((c) => {
                      const selected = selectedCats.has(c);
                      return (
                        <li key={c} role="presentation">
                          <button
                            type="button"
                            role="option"
                            aria-selected={selected}
                            className={`cat-dropdown-option${selected ? " cat-dropdown-option-selected" : ""}`}
                            onClick={() => toggleCategory(c)}
                          >
                            <span className="cat-dropdown-option-mark" aria-hidden>
                              {selected ? "✓" : "\u00a0"}
                            </span>
                            <span className="cat-dropdown-option-label">{formatCategoryLabel(c)}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {selectedCats.size > 0 ? (
                    <button
                      type="button"
                      className="btn-text cat-dropdown-clear"
                      onClick={() => {
                        startTransition(() => setSelectedCats(new Set()));
                      }}
                    >
                      Clear selection
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
          <div className="filter-cell filter-cell--sort">
            <span className="filter-heading">Order</span>
            <button
              type="button"
              className="btn-sort"
              onClick={() =>
                startTransition(() => setSortOrder((o) => (o === "newest" ? "oldest" : "newest")))
              }
              aria-pressed={sortOrder === "oldest"}
              aria-label={
                sortOrder === "newest"
                  ? "Sort order: newest first. Activate to show oldest first."
                  : "Sort order: oldest first. Activate to show newest first."
              }
              title={
                sortOrder === "newest"
                  ? "Newest first (date, then edition). Click for oldest first."
                  : "Oldest first (date, then edition). Click for newest first."
              }
            >
              <span className="btn-sort-icon">{sortOrder === "newest" ? <IconSortNewest /> : <IconSortOldest />}</span>
            </button>
          </div>
        </div>
        <div className="meta">
          {totalFiltered > PAGE_SIZE ? (
            <>
              Showing{" "}
              <strong style={{ color: "var(--text)" }}>
                {rangeStart}–{rangeEnd}
              </strong>{" "}
              of{" "}
              <strong style={{ color: "var(--text)" }}>{totalFiltered}</strong> matching ·{" "}
              <strong style={{ color: "var(--text)" }}>{raw.n}</strong> total
            </>
          ) : (
            <>
              Showing{" "}
              <strong style={{ color: "var(--text)" }}>{totalFiltered}</strong> of {raw.n}
            </>
          )}
          {(deferredQ !== q || deferredUserQ !== userQ) && (
            <span className="meta-deferred" aria-live="polite">
              {" "}
              (updating…)
            </span>
          )}
        </div>
      </section>

      {showPagination ? (
        <PaginationBar
          variant="top"
          pageClamped={pageClamped}
          totalPages={totalPages}
          onPrev={() => setPage((p) => Math.max(0, p - 1))}
          onNext={() =>
            setPage((p) => Math.min(totalPages - 1, p + 1))
          }
        />
      ) : null}

      <div className="feed">
        {visibleEvents.map((ev) => (
          <EventCard
            key={eventStableKey(ev, raw.ed)}
            ev={ev}
            edition={raw.ed[ev.x]}
            userHighlight={userHighlight}
            searchHighlight={searchHighlight}
          />
        ))}
      </div>

      {showPagination ? (
        <PaginationBar
          variant="bottom"
          pageClamped={pageClamped}
          totalPages={totalPages}
          onPrev={() => setPage((p) => Math.max(0, p - 1))}
          onNext={() =>
            setPage((p) => Math.min(totalPages - 1, p + 1))
          }
        />
      ) : null}
        </div>
      ) : activeTab === "contributors" ? (
        <ContributorsPanel editions={raw.ed} />
      ) : (
        <StatisticsPanel editions={raw.ed} />
      )}

      <footer className="site-footer">
        <p className="meta">
          Events are parsed from HF News Editions.{" "}
          <a
            href="https://github.com/xadamxk/hf-news-archive"
            target="_blank"
            rel="noreferrer"
          >
            HF News Archive Project
          </a>{" "}
          ·{" "}
          <a href="https://hackforums.net/" target="_blank" rel="noreferrer">
            hackforums.net
          </a>
        </p>
      </footer>
    </>
  );
}
