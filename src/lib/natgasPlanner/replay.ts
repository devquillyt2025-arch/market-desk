/**
 * Replays the plan rule over past sessions to see what it would have done - the same resolver a live tracker would use, run on
 * the one-minute candles of completed sessions. It is evidence about the rule, not a forecast: the rule is fixed (1.5 ATR stops,
 * the chosen ratios), signals are Heikin Ashi flips on completed bars, one position at a time per timeframe and ratio, flat by 23:20.
 */

import { aggregateBars, dayRanges, istDay, istDayStart, lowerBound, minuteOfDay, usableSessions } from "@/lib/natgasPlanner/bars";
import { COSTS, DEFAULT_ATR_MULT, MIN_LIQUID_SHARE, RATIOS, SESSION, TICK, VERDICT_MIN_PLANS, VERDICT_MIN_SESSIONS, LOT, type Timeframe } from "@/lib/natgasPlanner/config";
import { fees } from "@/lib/natgasPlanner/costs";
import { atr as atrSeries, flips, heikinAshi } from "@/lib/natgasPlanner/indicators";
import { makePlan } from "@/lib/natgasPlanner/plan";
import type { Candle, ExitStatus, Side } from "@/lib/natgasPlanner/types";

const cents = (x: number) => Math.round(x * 100) / 100;

export type Resolution = { status: ExitStatus; exitT: number; exitFill: number; net: number };

/**
 * Walks one-minute candles from the entry minute (inclusive) to the flat-by minute and finds how the trade ends. A candle that opens
 * beyond the stop fills there (plus a tick of slippage against); a candle that touches both the stop and the target is a stop; no
 * slippage on a target. If neither is touched the trade is closed at the last candle's close, a tick against. `candles` is ascending.
 */
export function resolveTrade(side: Side, stop: number, target: number, entryFill: number, candles: readonly Candle[], from: number): Resolution {
  const long = side === "long";
  const slip = COSTS.slippageTicks * TICK;
  // Candles are ascending, so everything at or before flat-by on the entry day is a run of them: one time to compare, no date per step.
  const flatByT = istDayStart(candles[from].t) + SESSION.flatBy * 60_000;
  let last = from;

  const done = (status: ExitStatus, exitT: number, rawFill: number): Resolution => {
    const exitFill = cents(rawFill);
    const gross = (long ? exitFill - entryFill : entryFill - exitFill) * LOT;
    const cost = long ? fees(entryFill, exitFill) : fees(exitFill, entryFill);
    return { status, exitT, exitFill, net: gross - cost };
  };

  for (let i = from; i < candles.length; i++) {
    const c = candles[i];
    if (c.t > flatByT) break;
    last = i;
    if (long) {
      if (c.o <= stop) return done("stop", c.t, c.o - slip);
      if (c.l <= stop) return done("stop", c.t, stop - slip);
      if (c.h >= target) return done("target", c.t, target);
    } else {
      if (c.o >= stop) return done("stop", c.t, c.o + slip);
      if (c.h >= stop) return done("stop", c.t, stop + slip);
      if (c.l <= target) return done("target", c.t, target);
    }
  }
  const c = candles[last];
  return done("eod", c.t, long ? c.c - slip : c.c + slip);
}

export type ReplayedPlan = {
  tf: Timeframe;
  ratio: number;
  day: string;
  /** The signalling bar's start. */
  barStart: number;
  side: Side;
  entryT: number;
  entry: number;
  stop: number;
  target: number;
  status: ExitStatus;
  exitT: number;
  net: number;
};

/**
 * Every plan the rule would have logged on a timeframe: one per fresh flip on a completed bar with an entry minute the same day at or
 * before the last-entry time, for each ratio. `candles` are ascending; `nowMs` decides which bars are complete.
 */
export function replayTimeframe(candles: readonly Candle[], tf: Timeframe, nowMs: number): ReplayedPlan[] {
  const bars = aggregateBars(candles, tf, nowMs);
  const ha = heikinAshi(bars);
  const atr = atrSeries(bars);
  const out: ReplayedPlan[] = [];

  for (const flip of flips(ha)) {
    const bar = bars[flip.index];
    if (!bar.complete) continue;
    const a = atr[flip.index];
    const entryIdx = lowerBound(candles, bar.end);
    const entryCandle = candles[entryIdx];
    if (a === null || !entryCandle || istDay(entryCandle.t) !== bar.day || minuteOfDay(entryCandle.t) > SESSION.lastEntry) continue;

    for (const ratio of RATIOS) {
      const plan = makePlan({ side: flip.side, entry: entryCandle.o, atr: a, atrMult: DEFAULT_ATR_MULT, ratio, riskBudget: 0 });
      if (!plan) continue;
      const r = resolveTrade(flip.side, plan.stop, plan.target, plan.entryFill, candles, entryIdx);
      out.push({ tf, ratio, day: bar.day, barStart: bar.t, side: flip.side, entryT: entryCandle.t, entry: entryCandle.o, stop: plan.stop, target: plan.target, status: r.status, exitT: r.exitT, net: r.net });
    }
  }
  return out;
}

/**
 * One position at a time per timeframe and ratio: a plan counts only if its entry minute is strictly after the previous counted
 * plan's exit minute. `plans` must already be one timeframe and ratio; order does not matter.
 */
export function countPlans<T extends { entryT: number; exitT: number }>(plans: readonly T[]): T[] {
  const counted: T[] = [];
  let lastExit = -Infinity;
  for (const p of [...plans].sort((a, b) => a.entryT - b.entryT)) {
    if (p.entryT > lastExit) {
      counted.push(p);
      lastExit = p.exitT;
    }
  }
  return counted;
}

export type ReplayStats = {
  n: number;
  /** Target hits as a share of counted plans, 0-100. */
  winPct: number | null;
  /** Mean net rupees per lot per trade. */
  avgNet: number | null;
  /** mean / (sd / sqrt(n)); null below two trades or with no spread. */
  t: number | null;
  sessions: number;
};

export function statsOf(counted: readonly { status: ExitStatus; net: number; day: string }[]): ReplayStats {
  const n = counted.length;
  if (n === 0) return { n: 0, winPct: null, avgNet: null, t: null, sessions: 0 };
  const mean = counted.reduce((s, p) => s + p.net, 0) / n;
  let t: number | null = null;
  if (n >= 2) {
    const sd = Math.sqrt(counted.reduce((s, p) => s + (p.net - mean) ** 2, 0) / (n - 1));
    t = sd > 0 ? mean / (sd / Math.sqrt(n)) : null;
  }
  return {
    n,
    winPct: (counted.filter((p) => p.status === "target").length / n) * 100,
    avgNet: mean,
    t,
    sessions: new Set(counted.map((p) => p.day)).size,
  };
}

export type Verdict = { kind: "not-enough" | "none" | "negative" | "positive"; text: string };

/** What the numbers may be said to show: nothing until 100 counted plans over 30 sessions, and never that the rule "works". */
export function verdictFor(stats: ReplayStats): Verdict {
  if (stats.n < VERDICT_MIN_PLANS || stats.sessions < VERDICT_MIN_SESSIONS) {
    return { kind: "not-enough", text: `Not enough data yet (${stats.n} plans, ${stats.sessions} sessions)` };
  }
  if (stats.t === null || stats.t < 2) {
    return stats.t !== null && stats.t <= -2 ? { kind: "negative", text: "Negative after costs" } : { kind: "none", text: "No evidence of edge" };
  }
  return { kind: "positive", text: "Positive, keep verifying" };
}

export type TfReplay = {
  tf: Timeframe;
  /** Counted-plan stats per ratio. */
  byRatio: Record<string, ReplayStats>;
  /** The last few flips, newest first, with how each ratio would have ended (every flip, not only counted ones). */
  recent: { barStart: number; side: Side; entry: number; outcomes: Record<string, { status: ExitStatus; net: number }> }[];
};

export type Replay = { sessions: number; days: string[]; timeframes: TfReplay[] };

/** Days to replay: completed, with enough minutes traded that the candles are a market and not padding. */
export function liquidDays(candles: readonly Candle[], nowMs: number): Set<string> {
  const today = istDay(nowMs);
  const out = new Set<string>();
  for (const r of dayRanges(candles)) {
    if (r.day >= today) continue;
    let live = 0;
    for (let i = r.from; i < r.to; i++) if (candles[i].v > 0) live += 1;
    if (live / (r.to - r.from) >= MIN_LIQUID_SHARE) out.add(r.day);
  }
  return out;
}

/** The whole replay for every timeframe, over the liquid completed sessions of `candles` (ascending). */
export function buildReplay(candles: readonly Candle[], timeframes: readonly Timeframe[], nowMs: number): Replay {
  const days = liquidDays(candles, nowMs);
  const inDays: Candle[] = [];
  for (const r of dayRanges(candles)) if (days.has(r.day)) for (let i = r.from; i < r.to; i++) inDays.push(candles[i]);
  const kept = usableSessions(inDays, nowMs);
  // Everything in `kept` is a completed session, so every bar in it is complete.
  const result: TfReplay[] = timeframes.map((tf) => {
    const plans = replayTimeframe(kept, tf, nowMs);
    const byRatio: Record<string, ReplayStats> = {};
    for (const ratio of RATIOS) byRatio[String(ratio)] = statsOf(countPlans(plans.filter((p) => p.ratio === ratio)));

    const flipStarts = [...new Set(plans.map((p) => p.barStart))].sort((a, b) => b - a).slice(0, 10);
    const recent = flipStarts.map((barStart) => {
      const rows = plans.filter((p) => p.barStart === barStart);
      const outcomes: Record<string, { status: ExitStatus; net: number }> = {};
      for (const p of rows) outcomes[String(p.ratio)] = { status: p.status, net: p.net };
      return { barStart, side: rows[0].side, entry: rows[0].entry, outcomes };
    });
    return { tf, byRatio, recent };
  });
  return { sessions: days.size, days: [...days].sort(), timeframes: result };
}

