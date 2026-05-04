/** Compact event row from public/events.json */
export type CompactUser = { i: string; n: string; r?: string };

export type CompactEvent = {
  c: string;
  t: string;
  d?: string;
  l?: string;
  u?: CompactUser[];
  e: number;
  s: number;
};

export type EventsPayload = {
  v: number;
  n: number;
  a: CompactEvent[];
};

export const PROFILE_BASE =
  "https://hackforums.net/member.php?action=profile&uid=";
