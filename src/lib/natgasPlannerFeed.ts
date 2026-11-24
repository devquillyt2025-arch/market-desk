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
import { istDay, thinTradingPct, usableSessions } from "@/lib/natgasPlanner/bars";
import { HISTORY_DAYS, TIMEFRAMES, type Timeframe } from "@/lib/natgasPlanner/config";
import { buildReplay, verdictFor, type Replay, type ReplayStats, type Verdict } from "@/lib/natgasPlanner/replay";
import { analyseCandles, analyseTimeframe, type ChartBar, type TfOverview } from "@/lib/natgasPlanner/signals";
import type { Candle, ExitStatus, Side } from "@/lib/natgasPlanner/types";
import type { ActiveContract, ContractChoice, NatgasFuture } from "@/lib/natgasContract";
import { chooseContract, listNatgasFutures, resetContractChoice } from "@/lib/natgasContractFeed";
import { mcxSessionCloseIst } from "@/lib/types";
import { isUpstoxGetError, upstoxData, upstoxGet } from "@/lib/upstox/api";
import { fetchIntraday, fetchMinuteHistory, isCandleError, type CandleDeps } from "@/lib/upstox/minuteCandles";

const INTRADAY_TTL_MS = 8_000;
const QUOTE_TTL_MS = 4_000;
const DAY_MS = 86_400_000;

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
  choice: ContractChoice;
  /** Every natural gas future still listed, soonest expiry first - what the page offers to pick from. */
  contracts: NatgasFuture[];
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
  /** Each timeframe read from its Heikin Ashi bars - the reading the plan and the replay are built on. */
  timeframes: TfOverview[];
  /** The same timeframes read from plain candles (green when the close is above the open). */
  candleTimeframes: TfOverview[];
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
const intradayCache = new Map<string, { at: number; candles: Candle[] }>();
const quoteCache = new Map<string, { at: number; value: { price: number; lastTradeMs: number | null } | null }>();

export function resetPlannerFeed(): void {
  histories.clear();
  historyInflight.clear();
  resetContractChoice();
  intradayCache.clear();
  quoteCache.clear();
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
  const held = intradayCache.get(key);
  if (held && now - held.at < INTRADAY_TTL_MS) return held.candles;
  const r = await fetchIntraday(token, key, deps);
  if (isCandleError(r)) {
    // A lapsed token is the one thing worth failing for; a hiccup leaves the page on what it has.
    return r.error === "token_expired" ? { error: "token_expired", status: 401 } : (held?.candles ?? []);
  }
  intradayCache.set(key, { at: now, candles: r.candles });
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
  const held = quoteCache.get(key);
  if (held && now - held.at < QUOTE_TTL_MS) return held.value;
  const value = await (deps.getQuote ?? defaultQuote)(token, key).catch(() => null);
  quoteCache.set(key, { at: now, value });
  return value;
}

// --- the answer ---------------------------------------------------------------------------

/**
 * `selection`: an instrument key to plan on that contract, "auto" for the one with the most business in the last session, or
 * null (or a contract no longer listed) for the default - the nearest contract that isn't about to expire.
 */
export async function getPlanner(token: string, tf: Timeframe, deps: PlannerDeps = {}, selection: string | null = null): Promise<PlannerResult | PlannerError> {
  const now = (deps.now ?? Date.now)();
  const today = istDay(now);

  const futures = await (deps.getFutures ?? listNatgasFutures)(today);
  if ("error" in futures) return futures;
  if (futures.length === 0) return { error: "Upstox lists no natural gas futures right now.", status: 502 };

  const chosen = await chooseContract(token, futures, selection, today, deps);
  if ("error" in chosen) return chosen;
  const { contract, choice } = chosen;

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
    choice,
    contracts: futures,
    market: { open: isMarketOpen(now, "NATURALGAS"), closes: mcxSessionCloseIst(today) },
    mode: intraday.length > 0 ? "live" : "last-session",
    ltp: quote ? { price: quote.price, at: quote.lastTradeMs } : null,
    lastClose: last ? last.c : null,
    lastCandleAt: last ? last.t : null,
    prevClose: prev ? prev.c : null,
    thinPct: thinTradingPct(candles),
    timeframes: analyses.map((a) => a.overview),
    candleTimeframes: TIMEFRAMES.map((t) => analyseCandles(candles, t, now)),
    selected: { tf, chart: selected.chart },
    replay: { sessions: history.replay.sessions, timeframes: replayByTf, recent: history.replay.timeframes.find((r) => r.tf === tf)?.recent ?? [] },
  };
}
