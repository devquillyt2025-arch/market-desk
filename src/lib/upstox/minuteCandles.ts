/**
 * Server-only: one-minute candles from Upstox's historical-candle API, for the natural gas planner.
 *
 * Upstox answers newest first with `[ts, open, high, low, close, volume, oi]` and `ts` an ISO time with the +05:30 offset (the bar's
 * start); history takes the end date first and at most 27 days a request; today comes from the intraday route, empty until the day's
 * first trade. Quiet minutes arrive as padded candles (open = high = low = close, volume 0) and are kept: the share of them is the
 * "thin trading" measure. A 429 is retried with a growing wait; a 401 or 403 is the lapsed token.
 */

import type { Candle } from "@/lib/natgasPlanner/types";

const BASE = "https://api.upstox.com";
const MAX_DAYS_PER_REQUEST = 27;
/** About two requests a second at most. */
const SPACING_MS = 450;
const BACKOFF_MS = [1000, 3000, 9000];

export type CandleError = { error: string; status: number };
export const isCandleError = <T extends object>(r: T | CandleError): r is CandleError => "error" in r;

export type CandleDeps = {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
let lastRequestAt = 0;

async function pace(deps: CandleDeps) {
  const now = deps.now ?? Date.now;
  const wait = SPACING_MS - (now() - lastRequestAt);
  if (wait > 0) await (deps.sleep ?? realSleep)(wait);
  lastRequestAt = now();
}

/** Upstox's candle arrays, as ascending candles with no repeated minute. Anything malformed is dropped. */
export function parseCandles(body: unknown): Candle[] {
  const rows = (body as { data?: { candles?: unknown } } | null)?.data?.candles;
  if (!Array.isArray(rows)) return [];
  const byTime = new Map<number, Candle>();
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const t = typeof row[0] === "number" ? row[0] : Date.parse(String(row[0]));
    const [o, h, l, c, v] = [row[1], row[2], row[3], row[4], row[5]].map(Number);
    if (![t, o, h, l, c].every(Number.isFinite) || !(o > 0) || !(h > 0) || !(l > 0) || !(c > 0)) continue;
    byTime.set(t, { t, o, h, l, c, v: Number.isFinite(v) ? v : 0 });
  }
  return [...byTime.values()].sort((a, b) => a.t - b.t);
}

/** One GET, with the pacing, the 429 backoff and the lapsed-token answer. */
async function get(token: string, path: string, deps: CandleDeps): Promise<{ body: unknown } | CandleError> {
  const doFetch = deps.fetchImpl ?? fetch;
  for (let attempt = 0; ; attempt++) {
    await pace(deps);
    let res: Response;
    try {
      res = await doFetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store" });
    } catch {
      return { error: "Couldn't reach Upstox.", status: 502 };
    }
    if (res.status === 401 || res.status === 403) return { error: "token_expired", status: 401 };
    if (res.status === 429) {
      if (attempt >= BACKOFF_MS.length) return { error: "Upstox is rate limiting this app - try again in a moment.", status: 429 };
      await (deps.sleep ?? realSleep)(BACKOFF_MS[attempt]);
      continue;
    }
    if (!res.ok) return { error: `Upstox returned ${res.status}`, status: res.status === 400 ? 400 : 502 };
    return { body: await res.json().catch(() => null) };
  }
}

const key = (instrumentKey: string) => encodeURIComponent(instrumentKey);

/** [from, to] date pairs (yyyy-mm-dd, inclusive), oldest first, none longer than 27 days. */
export function chunkRanges(fromIso: string, toIso: string, maxDays = MAX_DAYS_PER_REQUEST): [string, string][] {
  const day = 86_400_000;
  const out: [string, string][] = [];
  let start = Date.parse(`${fromIso}T00:00:00Z`);
  const end = Date.parse(`${toIso}T00:00:00Z`);
  while (start <= end) {
    const stop = Math.min(start + (maxDays - 1) * day, end);
    out.push([new Date(start).toISOString().slice(0, 10), new Date(stop).toISOString().slice(0, 10)]);
    start = stop + day;
  }
  return out;
}

/**
 * One-minute candles from `fromIso` to `toIso` (inclusive), ascending, in 27-day requests. A range before the contract was listed
 * simply comes back empty (or as a 400, treated the same); only a lapsed token or an unreachable Upstox is an error.
 */
export async function fetchMinuteHistory(token: string, instrumentKey: string, fromIso: string, toIso: string, deps: CandleDeps = {}): Promise<{ candles: Candle[] } | CandleError> {
  const all = new Map<number, Candle>();
  for (const [from, to] of chunkRanges(fromIso, toIso)) {
    const result = await get(token, `/v3/historical-candle/${key(instrumentKey)}/minutes/1/${to}/${from}`, deps);
    if (isCandleError(result)) {
      if (result.status === 400) continue;
      return result;
    }
    for (const c of parseCandles(result.body)) all.set(c.t, c);
  }
  return { candles: [...all.values()].sort((a, b) => a.t - b.t) };
}

/** Today's one-minute candles so far, ascending; empty before the first trade of the day. */
export async function fetchIntraday(token: string, instrumentKey: string, deps: CandleDeps = {}): Promise<{ candles: Candle[] } | CandleError> {
  const result = await get(token, `/v3/historical-candle/intraday/${key(instrumentKey)}/minutes/1`, deps);
  if (isCandleError(result)) return result;
  return { candles: parseCandles(result.body) };
}

/** Each recent day's traded volume (yyyy-mm-dd -> contracts) from the daily candles - the cheap way to tell which contract has the business. */
export async function fetchDailyVolumes(token: string, instrumentKey: string, fromIso: string, toIso: string, deps: CandleDeps = {}): Promise<{ volumes: Map<string, number> } | CandleError> {
  const result = await get(token, `/v3/historical-candle/${key(instrumentKey)}/days/1/${toIso}/${fromIso}`, deps);
  if (isCandleError(result)) return result;
  const rows = (result.body as { data?: { candles?: unknown } } | null)?.data?.candles;
  const volumes = new Map<string, number>();
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (Array.isArray(row) && typeof row[0] === "string" && Number.isFinite(Number(row[5]))) volumes.set(row[0].slice(0, 10), Number(row[5]));
    }
  }
  return { volumes };
}
