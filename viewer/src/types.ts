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
  v: number;
  ed: CompactEditionRow[];
  n: number;
  a: CompactEvent[];
};

export const PROFILE_BASE =
  "https://hackforums.net/member.php?action=profile&uid=";
