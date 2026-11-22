/**
 * Server side of the natural gas planner: picks the active MCX natural gas future, reads its one-minute candles from Upstox (the
 * contract's recent history, kept for the day, and today's so far), and works out what each timeframe says now - the signal, the ATR
 * and the bars to draw - plus a replay of the same plan rule over the contract's completed sessions.
 *
 * Nothing is stored: Upstox serves only live contracts, so history is read afresh and kept in memory for the IST day. The plan
 * itself (stop, target, costs, size) is not worked out here - it depends on controls the page owns, so the page computes it from the
 * ATR and the price with the same pure code (lib/natgasPlanner/plan.ts).
 */

import { isMarketOpen } from "@/lib/averaging";
import { parseMcxQuote } from "@/lib/expectedOpen";
import { contractMonthLabel } from "@/lib/mcxCommodities";
import { istDay, thinTradingPct, usableSessions } from "@/lib/natgasPlanner/bars";
import { HISTORY_DAYS, TIMEFRAMES, type Timeframe } from "@/lib/natgasPlanner/config";
import { buildReplay, verdictFor, type Replay, type ReplayStats, type Verdict } from "@/lib/natgasPlanner/replay";
import { analyseTimeframe, type ChartBar, type TfOverview } from "@/lib/natgasPlanner/signals";
import type { Candle, ExitStatus, Side } from "@/lib/natgasPlanner/types";
import { mcxSessionCloseIst } from "@/lib/types";
import { isUpstoxGetError, upstoxData, upstoxGet } from "@/lib/upstox/api";
import { getMcxContracts, isMcxError } from "@/lib/upstox/mcx";
import { fetchDailyVolumes, fetchIntraday, fetchMinuteHistory, isCandleError, type CandleDeps } from "@/lib/upstox/minuteCandles";

const INTRADAY_TTL_MS = 8_000;
const QUOTE_TTL_MS = 4_000;
const DAY_MS = 86_400_000;

export type NatgasFuture = { key: string; expiry: string; label: string };
export type ActiveContract = NatgasFuture & { reason: string };

export type ReplayCell = { stats: ReplayStats; verdict: Verdict };
export type ReplayView = {
  /** Completed liquid sessions the replay covers. */
  sessions: number;
  timeframes: { tf: Timeframe; byRatio: Record<string, ReplayCell> }[];
  /** The selected timeframe's last flips, newest first, with how each ratio would have ended. */
  recent: { barStart: number; side: Side; entry: number; outcomes: Record<string, { status: ExitStatus; net: number }> }[];
};

export type PlannerResult = {
  asOf: number;
  contract: ActiveContract;
  market: { open: boolean; closes: "23:30" | "23:55" };
  /** `live`: today's candles are coming in; `last-session`: none yet (shut, or before the first trade), so everything is from the last session. */
  mode: "live" | "last-session";
  ltp: { price: number; at: number | null } | null;
  /** The last one-minute candle's close and start, and the close of the session before its day. */
  lastClose: number | null;
  lastCandleAt: number | null;
  prevClose: number | null;
  /** Share (0-100) of zero-volume minutes in the last hour of candles. */
  thinPct: number | null;
  timeframes: TfOverview[];
  selected: { tf: Timeframe; chart: ChartBar[] };
  replay: ReplayView;
};

export type PlannerError = { error: string; status?: number };

export type PlannerDeps = CandleDeps & {
  /** The natural gas futures still listed, soonest expiry first. */
  getFutures?: (todayIso: string) => Promise<NatgasFuture[] | PlannerError>;
  getQuote?: (token: string, key: string) => Promise<{ price: number; lastTradeMs: number | null } | null>;
};

// --- caches (reset for tests) -------------------------------------------------------------

type History = { day: string; candles: Candle[]; replay: Replay };
const histories = new Map<string, History>();
const historyInflight = new Map<string, Promise<History | PlannerError>>();
let activeCache: { day: string; value: ActiveContract } | null = null;
let intradayCache: { key: string; at: number; candles: Candle[] } | null = null;
let quoteCache: { key: string; at: number; value: { price: number; lastTradeMs: number | null } | null } | null = null;

export function resetPlannerFeed(): void {
  histories.clear();
  historyInflight.clear();
  activeCache = null;
  intradayCache = null;
  quoteCache = null;
}

// --- the contract -------------------------------------------------------------------------

/** "NATURALGAS FUT 24 NOV 26" from an expiry date. */
function futureLabel(expiryIso: string): string {
  const [y, m, d] = expiryIso.split("-");
  const month = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][Number(m) - 1] ?? m;
  return `NATURALGAS FUT ${d} ${month} ${y.slice(2)}`;
}

async function defaultFutures(todayIso: string): Promise<NatgasFuture[] | PlannerError> {
  const mcx = await getMcxContracts();
  if (isMcxError(mcx)) return { error: mcx.error, status: mcx.status };
  const out: NatgasFuture[] = [];
  for (const [key, c] of mcx.contracts) {
    if (c.instrument === "NATURALGAS" && c.strike === null && c.optionType === null && c.expiry >= todayIso) out.push({ key, expiry: c.expiry, label: futureLabel(c.expiry) });
  }
  return out.sort((a, b) => a.expiry.localeCompare(b.expiry));
}

/**
 * Of the first two unexpired contracts, the one with the larger traded volume over the last completed session; the nearer one when
 * the volumes are unknown or level. Exported for testing.
 */
export function chooseActive(futures: readonly NatgasFuture[], volumes: ReadonlyMap<string, number | null>): ActiveContract {
  const [near, next] = futures;
  if (!next) return { ...near, reason: "the only contract listed" };
  const a = volumes.get(near.key);
  const b = volumes.get(next.key);
  if (a == null || b == null) return { ...near, reason: "nearest expiry (volumes unavailable)" };
  const n = (v: number) => v.toLocaleString("en-IN");
  return b > a
    ? { ...next, reason: `more business than ${contractMonthLabel(near.expiry)} in the last session (${n(b)} vs ${n(a)})` }
    : { ...near, reason: `more business than ${contractMonthLabel(next.expiry)} in the last session (${n(a)} vs ${n(b)})` };
}

async function resolveActive(token: string, futures: NatgasFuture[], today: string, deps: PlannerDeps): Promise<ActiveContract | PlannerError> {
  if (activeCache?.day === today) {
    const hit = futures.find((f) => f.key === activeCache!.value.key);
    if (hit) return activeCache.value;
  }
  const firstTwo = futures.slice(0, 2);
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - 8 * DAY_MS).toISOString().slice(0, 10);
  const perKey = new Map<string, Map<string, number>>();
  for (const f of firstTwo) {
    const r = await fetchDailyVolumes(token, f.key, from, today, deps);
    if (isCandleError(r)) {
      if (r.error === "token_expired") return { error: "token_expired", status: 401 };
      continue; // volumes are only a tie-break: fall back to the nearest expiry
    }
    perKey.set(f.key, r.volumes);
  }
  // The last session both contracts have a day for, before today.
  const days = [...new Set([...perKey.values()].flatMap((m) => [...m.keys()]))].filter((d) => d < today).sort();
  const day = days.at(-1);
  const volumes = new Map<string, number | null>(firstTwo.map((f) => [f.key, day ? (perKey.get(f.key)?.get(day) ?? null) : null]));
  const value = chooseActive(firstTwo, volumes);
  activeCache = { day: today, value };
  return value;
}

// --- candles ------------------------------------------------------------------------------

async function loadHistory(token: string, key: string, today: string, now: number, deps: PlannerDeps): Promise<History | PlannerError> {
  const held = histories.get(key);
  if (held?.day === today) return held;
  const running = historyInflight.get(key);
  if (running) return running;

  const run = (async (): Promise<History | PlannerError> => {
    const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
    const from = new Date(Date.parse(`${today}T00:00:00Z`) - HISTORY_DAYS * DAY_MS).toISOString().slice(0, 10);
    const r = await fetchMinuteHistory(token, key, from, yesterday, deps);
    if (isCandleError(r)) return { error: r.error, status: r.status };
    // Only completed days: today's come from the intraday route, afresh each time.
    const candles = r.candles.filter((c) => istDay(c.t) < today);
    const entry: History = { day: today, candles, replay: buildReplay(candles, TIMEFRAMES, now) };
    histories.set(key, entry);
    return entry;
  })().finally(() => historyInflight.delete(key));
  historyInflight.set(key, run);
  return run;
}

async function loadIntraday(token: string, key: string, now: number, deps: PlannerDeps): Promise<Candle[] | PlannerError> {
  if (intradayCache && intradayCache.key === key && now - intradayCache.at < INTRADAY_TTL_MS) return intradayCache.candles;
  const r = await fetchIntraday(token, key, deps);
  if (isCandleError(r)) {
    // A lapsed token is the one thing worth failing for; a hiccup leaves the page on what it has.
    return r.error === "token_expired" ? { error: "token_expired", status: 401 } : (intradayCache?.key === key ? intradayCache.candles : []);
  }
  intradayCache = { key, at: now, candles: r.candles };
  return r.candles;
}

async function defaultQuote(token: string, key: string): Promise<{ price: number; lastTradeMs: number | null } | null> {
  const r = await upstoxGet(token, `/v2/market-quote/quotes?${new URLSearchParams({ instrument_key: key })}`);
  if (isUpstoxGetError(r)) return null;
  const data = upstoxData(r.body);
  if (!data || typeof data !== "object") return null;
  for (const entry of Object.values(data as Record<string, { instrument_token?: string }>)) {
    if (entry?.instrument_token === key) return parseMcxQuote(entry);
  }
  return null;
}

async function loadQuote(token: string, key: string, now: number, deps: PlannerDeps) {
  if (quoteCache && quoteCache.key === key && now - quoteCache.at < QUOTE_TTL_MS) return quoteCache.value;
  const value = await (deps.getQuote ?? defaultQuote)(token, key).catch(() => null);
  quoteCache = { key, at: now, value };
  return value;
}

// --- the answer ---------------------------------------------------------------------------

export async function getPlanner(token: string, tf: Timeframe, deps: PlannerDeps = {}): Promise<PlannerResult | PlannerError> {
  const now = (deps.now ?? Date.now)();
  const today = istDay(now);

  const futures = await (deps.getFutures ?? defaultFutures)(today);
  if ("error" in futures) return futures;
  if (futures.length === 0) return { error: "Upstox lists no natural gas futures right now.", status: 502 };

  const contract = await resolveActive(token, futures, today, deps);
  if ("error" in contract) return contract;

  const history = await loadHistory(token, contract.key, today, now, deps);
  if ("error" in history) return history;
  const intraday = await loadIntraday(token, contract.key, now, deps);
  if ("error" in intraday) return intraday;

  const known = new Map<number, Candle>();
  for (const c of history.candles) known.set(c.t, c);
  for (const c of intraday) known.set(c.t, c);
  const candles = usableSessions([...known.values()].sort((a, b) => a.t - b.t), now);

  const quote = await loadQuote(token, contract.key, now, deps);
  const last = candles.at(-1) ?? null;
  const lastDay = last ? istDay(last.t) : null;
  const prev = lastDay ? [...candles].reverse().find((c) => istDay(c.t) < lastDay) : undefined;

  const analyses = TIMEFRAMES.map((t) => analyseTimeframe(candles, t, now));
  const selected = analyses[TIMEFRAMES.indexOf(tf)];

  const replayByTf = history.replay.timeframes.map((r) => ({
    tf: r.tf,
    byRatio: Object.fromEntries(Object.entries(r.byRatio).map(([ratio, stats]) => [ratio, { stats, verdict: verdictFor(stats) }])),
  }));

  return {
    asOf: now,
    contract,
    market: { open: isMarketOpen(now, "NATURALGAS"), closes: mcxSessionCloseIst(today) },
    mode: intraday.length > 0 ? "live" : "last-session",
    ltp: quote ? { price: quote.price, at: quote.lastTradeMs } : null,
    lastClose: last ? last.c : null,
    lastCandleAt: last ? last.t : null,
    prevClose: prev ? prev.c : null,
    thinPct: thinTradingPct(candles),
    timeframes: analyses.map((a) => a.overview),
    selected: { tf, chart: selected.chart },
    replay: { sessions: history.replay.sessions, timeframes: replayByTf, recent: history.replay.timeframes.find((r) => r.tf === tf)?.recent ?? [] },
  };
}
