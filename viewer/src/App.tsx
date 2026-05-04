import {
  memo,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  startTransition,
  useState,
} from "react";
import DatePicker from "react-datepicker";
import type { CompactEvent, CompactUser, EventsPayload } from "./types";
import { PROFILE_BASE } from "./types";

type DateFilterMode = "off" | "before" | "after" | "between";

/** Bounds for year/month dropdowns in the date filter calendar. */
const DATE_FILTER_MIN = new Date(2000, 0, 1);
const DATE_FILTER_MAX = new Date(2040, 11, 31);

const datePickerDropdownProps = {
  showMonthDropdown: true,
  showYearDropdown: true,
  dropdownMode: "select" as const,
  minDate: DATE_FILTER_MIN,
  maxDate: DATE_FILTER_MAX,
};

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

function UserLine({ u }: { u: CompactUser }) {
  const hasUid = u.i && u.i.length > 0;
  const body = hasUid ? (
    <a href={`${PROFILE_BASE}${encodeURIComponent(u.i)}`} target="_blank" rel="noreferrer">
      {u.n || `(uid ${u.i})`}
    </a>
  ) : (
    <span>{u.n || "—"}</span>
  );
  return (
    <div className="user-line">
      <span className="user-line-inner">
        {body}
        {u.r ? <span className="user-role"> — {u.r}</span> : null}
      </span>
    </div>
  );
}

function eventStableKey(ev: CompactEvent): string {
  return `${ev.s}:${ev.e}:${ev.c}:${ev.t}`;
}

const EventCard = memo(function EventCard({ ev }: { ev: CompactEvent }) {
  const iso = useMemo(() => isoDateTime(ev.s), [ev.s]);
  const displayDate = useMemo(() => formatDate(ev.s), [ev.s]);
  return (
    <article className="card">
      <div className="post-top">
        <div className="post-main">
          <h2 className="card-title">{ev.t}</h2>
          <p className="post-meta">
            <span className="post-meta-strong">Edition {ev.e}</span>
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
      {ev.d ? <p className="card-desc">{ev.d}</p> : null}
      {ev.l ? (
        <div className="card-row">
          <strong>URL</strong>{" "}
          <a href={ev.l} target="_blank" rel="noreferrer">
            {ev.l}
          </a>
        </div>
      ) : null}
      {ev.u?.length ? (
        <div className="card-row card-row-users">
          <strong>Users</strong>
          <div className="user-list">
            {ev.u.map((u, i) => (
              <UserLine key={`${u.i}-${u.n}-${i}`} u={u} />
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
});

type SortOrder = "newest" | "oldest";

export default function App() {
  const [raw, setRaw] = useState<EventsPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}events.json`);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const data = (await res.json()) as EventsPayload;
        if (!cancelled) {
          if (!data?.a || !Array.isArray(data.a)) throw new Error("Invalid events payload");
          setRaw(data);
        }
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

  /** Highest edition number in the archive, with the latest event date within that edition. */
  const latestEditionHeadline = useMemo(() => {
    if (!raw?.a.length) return null;
    let maxEd = -Infinity;
    for (const ev of raw.a) {
      const ne = Number(ev.e);
      if (Number.isFinite(ne) && ne > maxEd) maxEd = ne;
    }
    if (maxEd === -Infinity) return null;
    let dateSec = 0;
    let editionLabel = String(maxEd);
    for (const ev of raw.a) {
      if (Number(ev.e) !== maxEd) continue;
      if (ev.s > dateSec) dateSec = ev.s;
      editionLabel = String(ev.e);
    }
    return { edition: editionLabel, dateSec };
  }, [raw]);

  const filtered = useMemo(() => {
    if (!raw) return [];
    const qq = deferredQ.trim().toLowerCase();
    const uq = deferredUserQ.trim().toLowerCase();
    return raw.a.filter((ev) => {
      if (selectedCats.size > 0 && !selectedCats.has(ev.c)) return false;
      if (qq) {
        const blob = `${ev.t} ${ev.d ?? ""}`.toLowerCase();
        if (!blob.includes(qq)) return false;
      }
      if (uq) {
        const users = ev.u ?? [];
        const hit = users.some(
          (u) =>
            u.i.toLowerCase().includes(uq) ||
            (u.n && u.n.toLowerCase().includes(uq))
        );
        if (!hit) return false;
      }
      if (dateFilterMode === "before") {
        const lim = startOfLocalDaySec(dateFilterA);
        if (lim !== null && !(ev.s < lim)) return false;
      } else if (dateFilterMode === "after") {
        const lim = endOfLocalDayExclusiveSec(dateFilterA);
        if (lim !== null && !(ev.s >= lim)) return false;
      } else if (dateFilterMode === "between") {
        const a = dateFilterA.trim();
        const b = dateFilterB.trim();
        if (a && b) {
          const dLo = a <= b ? a : b;
          const dHi = a <= b ? b : a;
          const t0 = startOfLocalDaySec(dLo);
          const t1 = endOfLocalDayExclusiveSec(dHi);
          if (t0 !== null && t1 !== null && !(ev.s >= t0 && ev.s < t1)) return false;
        }
      }
      return true;
    });
  }, [raw, deferredQ, deferredUserQ, selectedCats, dateFilterMode, dateFilterA, dateFilterB]);

  const displayEvents = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const cmpS = a.s - b.s;
      if (cmpS !== 0) return sortOrder === "newest" ? -cmpS : cmpS;
      const cmpE = Number(a.e) - Number(b.e);
      return sortOrder === "newest" ? -cmpE : cmpE;
    });
    return arr;
  }, [filtered, sortOrder]);

  function toggleCategory(c: string) {
    startTransition(() => {
      setSelectedCats((prev) => {
        const n = new Set(prev);
        if (n.has(c)) n.delete(c);
        else n.add(c);
        return n;
      });
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
          HF News archive
        </h1>
        <p className="meta" style={{ margin: 0 }}>
          {raw.n} events
          {latestEditionHeadline ? (
            <>
              {" — "}
              Latest Edition {latestEditionHeadline.edition} ({formatDate(latestEditionHeadline.dateSec)})
            </>
          ) : null}
        </p>
      </header>

      <section className="toolbar" aria-label="Search and filters">
        <div className="toolbar-row toolbar-row-split">
          <label className="toolbar-label-search">
            Search title / description
            <input
              type="search"
              placeholder="e.g. Omniscient, ban, MOTM…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="toolbar-label-user">
            User (name or UID)
            <input
              type="text"
              placeholder="username or uid substring"
              value={userQ}
              onChange={(e) => setUserQ(e.target.value)}
              autoComplete="off"
            />
          </label>
          <div className="toolbar-date-field">
              <span className="toolbar-sort-heading" id="date-filter-label">
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
          <div className="cat-dropdown">
            <span className="cat-dropdown-field-label" id="cat-dropdown-label">
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
                  {selectedCats.size === 0 ? "All categories" : `${selectedCats.size} selected`}
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
                            <span className="cat-dropdown-option-label">{c}</span>
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
          <div className="toolbar-sort-field">
            <span className="toolbar-sort-heading">Order</span>
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
          Showing <strong style={{ color: "var(--text)" }}>{displayEvents.length}</strong> of {raw.n}
          {(deferredQ !== q || deferredUserQ !== userQ) && (
            <span className="meta-deferred" aria-live="polite">
              {" "}
              (updating…)
            </span>
          )}
        </div>
      </section>

      <div className="feed">
        {displayEvents.map((ev) => (
          <EventCard key={eventStableKey(ev)} ev={ev} />
        ))}
      </div>

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
