/** Compact edition row from public/events.json (lookup via event.x) */
export type CompactEditionRow = {
  e: number;
  s: number;
  p: string;
  a: string;
  h: string;
};

/** Compact event row from public/events.json */
export type CompactUser = { i: string; n: string; r?: string };

export type CompactEvent = {
  c: string;
  t: string;
  d?: string;
  l?: string;
  u?: CompactUser[];
  /** Index into EventsPayload.ed */
  x: number;
};

export type EventsPayload = {
  ed: CompactEditionRow[];
  n: number;
  a: CompactEvent[];
};

export const PROFILE_BASE =
  "https://hackforums.net/member.php?action=profile&uid=";

/** Row from public/contributors.json (one per uid). */
export type ContributorRow = {
  i: string;
  u: string;
  e: number;
  r?: string[];
  f: number;
  l: number;
};

export type ContributorsPayload = {
  n: number;
  c: ContributorRow[];
};

/** Per-edition row from public/stats.json (short-key minified). */
export type StatsRow = {
  e: number;
  // Site stats
  tp?: number;
  tt?: number;
  tm?: number;
  dp?: number;
  dt?: number;
  dm?: number;
  // Ban stats — last week
  bs?: number;
  bv?: number;
  bc?: number;
  // Ban stats — cumulative totals
  bts?: number;
  btv?: number;
  btc?: number;
  // Forum Counts — notable sections
  lt?: number;
  lp?: number;
  rt?: number;
  rp?: number;
  // Forum Counts — major tabs
  tab?: Record<string, { t?: number; p?: number }>;
};

export type StatsPayload = {
  n: number;
  s: StatsRow[];
};
