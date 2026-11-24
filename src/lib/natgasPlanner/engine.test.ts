/**
 * The natural gas planner's engine against the acceptance numbers written for it: the cost model, the Heikin Ashi and ATR golden
 * series, the plan example, the four resolver cases and their short mirror - plus the rules around them (anchoring, the forming bar,
 * the entry window, one position at a time, the verdict threshold).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { aggregateBars, istDay, lowerBound, thinTradingPct, usableSessions } from "@/lib/natgasPlanner/bars";
import { COSTS, LOT, TICK, type Timeframe } from "@/lib/natgasPlanner/config";
import { costFloor, fees, roundToTick, roundUpToTick } from "@/lib/natgasPlanner/costs";
import { atr, flips, heikinAshi } from "@/lib/natgasPlanner/indicators";
import { costShareTone, makePlan } from "@/lib/natgasPlanner/plan";
import { buildReplay, countPlans, replayTimeframe, resolveTrade, statsOf, verdictFor } from "@/lib/natgasPlanner/replay";
import { pivotLevels } from "@/lib/natgasPlanner/pivots";
import { analyseCandles, analyseTimeframe, entryWindow } from "@/lib/natgasPlanner/signals";
import type { Candle } from "@/lib/natgasPlanner/types";

const at = (iso: string) => Date.parse(iso);
const near = (a: number, b: number, eps = 0.005) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

// ---- costs -----------------------------------------------------------------------------

describe("costs", () => {
  it("charges ₹110.60 on a lot bought and sold at 295.00", () => {
    near(fees(295, 295), 110.6);
  });

  it("is a lot of 1,250 mmBtu in ticks of 10 paise", () => {
    assert.equal(LOT, 1250);
    assert.equal(TICK, 0.1);
  });

  it("rounds a stop UP to the next tick and a target to the nearest", () => {
    assert.equal(roundUpToTick(1.475), 1.5);
    assert.equal(roundUpToTick(1.5), 1.5);
    assert.equal(roundUpToTick(1.51), 1.6);
    assert.equal(roundUpToTick(0.01), 0.1);
    assert.equal(roundToTick(2.96), 3.0);
    assert.equal(roundToTick(2.94), 2.9);
  });

  it("puts the cost floor at 1.442 at 295, which a stop rounds up to 1.50", () => {
    near(costFloor(295), 1.4424, 0.0005);
    assert.equal(roundUpToTick(costFloor(295)), 1.5);
  });
});

// ---- Heikin Ashi and ATR golden series -------------------------------------------------

const GOLDEN = [
  { t: 0, o: 300.0, h: 302.0, l: 299.0, c: 301.0, day: "d" },
  { t: 1, o: 301.0, h: 303.0, l: 300.5, c: 302.5, day: "d" },
  { t: 2, o: 302.5, h: 303.0, l: 299.5, c: 300.0, day: "d" },
  { t: 3, o: 300.0, h: 300.5, l: 297.0, c: 297.5, day: "d" },
  { t: 4, o: 297.5, h: 301.0, l: 297.0, c: 300.5, day: "d" },
  { t: 5, o: 300.5, h: 303.5, l: 300.0, c: 303.0, day: "d" },
];

describe("Heikin Ashi", () => {
  const ha = heikinAshi(GOLDEN);
  it("reproduces the golden series (open / close / colour)", () => {
    const want: [number, number, boolean][] = [
      [300.5, 300.5, false],
      [300.5, 301.75, true],
      [301.125, 301.25, true],
      [301.1875, 298.75, false],
      [299.96875, 299.0, false],
      [299.484375, 301.75, true],
    ];
    want.forEach(([o, c, green], i) => {
      near(ha[i].o, o, 1e-9);
      near(ha[i].c, c, 1e-9);
      assert.equal(ha[i].green, green, `bar ${i}`);
    });
  });

  it("calls an equal open and close red", () => {
    assert.equal(ha[0].green, false);
  });

  it("flips at bars 1 (long), 3 (short) and 5 (long)", () => {
    assert.deepEqual(flips(ha), [
      { index: 1, side: "long" },
      { index: 3, side: "short" },
      { index: 5, side: "long" },
    ]);
  });

  it("keeps each HA high and low outside its own body", () => {
    for (const b of ha) assert.ok(b.h >= Math.max(b.o, b.c) && b.l <= Math.min(b.o, b.c));
  });
});

describe("ATR (Wilder)", () => {
  it("reproduces the golden series at period 3", () => {
    const series = atr(GOLDEN, 3);
    assert.equal(series[0], null);
    assert.equal(series[1], null);
    [3.0, 3.1667, 3.4444, 3.463].forEach((want, k) => near(series[k + 2] as number, want, 0.0001));
  });

  it("uses a bar's own range for the first bar of a day, not the gap from yesterday", () => {
    const bars = [
      { t: 0, o: 100, h: 101, l: 99, c: 100, day: "a" },
      { t: 1, o: 150, h: 152, l: 149, c: 151, day: "b" }, // a 50-point gap overnight
      { t: 2, o: 151, h: 152, l: 150, c: 151, day: "b" },
    ];
    const series = atr(bars, 3);
    // TRs: 2, 3 (H-L only, new day), 2 -> mean 2.333
    near(series[2] as number, (2 + 3 + 2) / 3, 1e-9);
  });
});

// ---- the plan ---------------------------------------------------------------------------

describe("makePlan", () => {
  const long = makePlan({ side: "long", entry: 295, atr: null, atrMult: 1.5, ratio: 2, stopPct: 0.5, riskBudget: 0 })!;

  it("places a long at 295.00 with a 0.5% stop (1.50) and a 1:2 target", () => {
    assert.equal(long.stopDist, 1.5);
    assert.equal(long.stop, 293.5);
    assert.equal(long.target, 298);
    assert.equal(long.effectiveRatio, 2);
    assert.equal(long.stopSource, "manual");
  });

  it("fills a tick against you on the entry and the stop, none on the target", () => {
    assert.equal(long.entryFill, 295.1);
    assert.equal(long.stopFill, 293.4);
    assert.equal(long.targetFill, 298);
  });

  it("loses ₹2,235.35 net at the stop and wins ₹3,513.93 net at the target", () => {
    near(long.netRisk, 2235.35);
    near(long.feesAtStop, 110.35);
    near(long.netReward, 3513.93);
    near(long.feesAtTarget, 111.07);
  });

  it("needs a 38.9% win rate after costs, against 33.3% without", () => {
    near(long.breakEven * 100, 38.9, 0.05);
    near(long.breakEvenNoCost * 100, 33.3, 0.05);
  });

  it("spends 19.2% of the risk on costs - green", () => {
    near(long.costShare * 100, 19.2, 0.05);
    assert.equal(costShareTone(long.costShare), "good");
  });

  it("states risk and reward in percent, rupees a mmBtu, and rupees a lot", () => {
    near(long.riskPct, (1.5 / 295) * 100, 1e-9);
    near(long.rewardPct, (3 / 295) * 100, 1e-9);
    assert.equal(long.grossRisk, 1875);
    assert.equal(long.grossReward, 3750);
    assert.equal(long.notional, 295 * 1250);
  });

  it("mirrors for a short: entry fill 294.90, stop 296.50 (fill 296.60, -₹2,235.67), target 292.00 (+₹3,514.59)", () => {
    const short = makePlan({ side: "short", entry: 295, atr: null, atrMult: 1.5, ratio: 2, stopPct: 0.5, riskBudget: 0 })!;
    assert.equal(short.stop, 296.5);
    assert.equal(short.target, 292);
    assert.equal(short.entryFill, 294.9);
    assert.equal(short.stopFill, 296.6);
    near(short.netRisk, 2235.67);
    near(short.feesAtStop, 110.67);
    near(short.netReward, 3514.59);
    near(short.feesAtTarget, 110.41);
  });

  it("sizes the stop from the ATR when it is wider than the cost floor, and from the floor when it is not", () => {
    const wide = makePlan({ side: "long", entry: 295, atr: 2.0, atrMult: 1.5, ratio: 2, riskBudget: 0 })!;
    assert.equal(wide.stopDist, 3.0);
    assert.equal(wide.stopSource, "atr");
    const tight = makePlan({ side: "long", entry: 295, atr: 0.2, atrMult: 1.5, ratio: 2, riskBudget: 0 })!;
    assert.equal(tight.stopDist, 1.5); // the 1.442 floor, rounded up
    assert.equal(tight.stopSource, "cost-floor");
  });

  it("has no plan without an ATR or a manual stop, and a manual rupee stop beats a percent one", () => {
    assert.equal(makePlan({ side: "long", entry: 295, atr: null, atrMult: 1.5, ratio: 2, riskBudget: 0 }), null);
    const both = makePlan({ side: "long", entry: 295, atr: 1, atrMult: 1.5, ratio: 2, stopPct: 1, stopAbs: 2, riskBudget: 0 })!;
    assert.equal(both.stopDist, 2);
  });

  it("gives the target a whole number of ticks, and reports the ratio that leaves", () => {
    const p = makePlan({ side: "long", entry: 295, atr: null, atrMult: 1.5, ratio: 1.5, stopAbs: 1.1, riskBudget: 0 })!;
    assert.equal(p.stopDist, 1.1);
    assert.equal(p.targetDist, 1.7); // 1.65 -> nearest tick
    near(p.effectiveRatio, 1.7 / 1.1, 1e-9);
  });

  it("sizes lots from a budget, or says a lot is too big for it", () => {
    const sized = makePlan({ side: "long", entry: 295, atr: null, atrMult: 1.5, ratio: 2, stopPct: 0.5, riskBudget: 10_000 })!;
    assert.equal(sized.lots, 4); // floor(10,000 / 2,235.35)
    assert.equal(sized.lotsNote, null);
    const small = makePlan({ side: "long", entry: 295, atr: null, atrMult: 1.5, ratio: 2, stopPct: 0.5, riskBudget: 1000 })!;
    assert.equal(small.lots, 0);
    assert.match(small.lotsNote ?? "", /Budget too small: 1 lot risks ₹2,235/);
    assert.equal(makePlan({ side: "long", entry: 295, atr: null, atrMult: 1.5, ratio: 2, stopPct: 0.5, riskBudget: 0 })!.lots, 0);
  });

  it("calls costs amber from 20% and red above 25% of the risk", () => {
    assert.equal(costShareTone(0.199), "good");
    assert.equal(costShareTone(0.2), "warn");
    assert.equal(costShareTone(0.25), "warn");
    assert.equal(costShareTone(0.2501), "bad");
  });
});

// ---- the resolver -----------------------------------------------------------------------

/** A run of one-minute candles from `from` on 2026-11-18, one per `steps` entry: [open, high, low, close]. */
function run(from: string, steps: [number, number, number, number][]): Candle[] {
  const start = at(`2026-11-18T${from}:00+05:30`);
  return steps.map(([o, h, l, c], i) => ({ t: start + i * 60_000, o, h, l, c, v: 10 }));
}

describe("resolveTrade (long: entry 295.00, stop 293.50, target 298.00)", () => {
  const entryFill = 295.1;

  it("A: reaches the target without touching the stop - ₹3,513.93", () => {
    const candles = run("10:00", [[295, 295.4, 294.8, 295.2], [295.2, 296, 295, 295.8], [295.8, 298.2, 295.5, 298.0]]);
    const r = resolveTrade("long", 293.5, 298, entryFill, candles, 0);
    assert.equal(r.status, "target");
    assert.equal(r.exitFill, 298);
    near(r.net, 3513.93);
  });

  it("B: a minute that touches both the stop and the target is a stop - fill 293.40, -₹2,235.35", () => {
    const candles = run("10:00", [[295, 295.4, 294.8, 295.2], [295.2, 298.1, 293.4, 296]]);
    const r = resolveTrade("long", 293.5, 298, entryFill, candles, 0);
    assert.equal(r.status, "stop");
    assert.equal(r.exitFill, 293.4);
    near(r.net, -2235.35);
  });

  it("C: a minute that opens below the stop fills at that open less a tick - 292.70, -₹3,110.24", () => {
    const candles = run("10:00", [[295, 295.4, 294.8, 295.2], [292.8, 293.0, 292.5, 292.9]]);
    const r = resolveTrade("long", 293.5, 298, entryFill, candles, 0);
    assert.equal(r.status, "stop");
    assert.equal(r.exitFill, 292.7);
    near(r.net, -3110.24);
  });

  it("D: nothing is hit by flat-by, so it closes at the last candle's close less a tick - 295.90, +₹889.26", () => {
    const steps: [number, number, number, number][] = [];
    for (let m = 10 * 60; m <= 23 * 60 + 20; m++) steps.push([295.5, 296.5, 294.5, m === 23 * 60 + 20 ? 296.0 : 295.5]);
    const candles = run("10:00", steps);
    const r = resolveTrade("long", 293.5, 298, entryFill, candles, 0);
    assert.equal(r.status, "eod");
    assert.equal(r.exitT, at("2026-11-18T23:20:00+05:30"));
    assert.equal(r.exitFill, 295.9);
    near(r.net, 889.26);
  });

  it("does not look past flat-by or into the next day", () => {
    const steps: [number, number, number, number][] = [];
    for (let m = 23 * 60 + 15; m <= 23 * 60 + 30; m++) steps.push([295.5, 295.9, 295.2, 295.5]);
    steps[10] = [295.5, 299, 295.2, 298.5]; // 23:25 - after flat-by, would have hit the target
    const r = resolveTrade("long", 293.5, 298, entryFill, run("23:15", steps), 0);
    assert.equal(r.status, "eod");
  });
});

describe("resolveTrade (short: entry 295.00, stop 296.50, target 292.00)", () => {
  const entryFill = 294.9;
  it("stops out at 296.60 for -₹2,235.67, and with the stop winning a double touch", () => {
    const candles = run("10:00", [[295, 295.2, 294.6, 294.9], [294.9, 296.5, 291.9, 295]]);
    const r = resolveTrade("short", 296.5, 292, entryFill, candles, 0);
    assert.equal(r.status, "stop");
    assert.equal(r.exitFill, 296.6);
    near(r.net, -2235.67);
  });

  it("reaches the target at 292.00 for +₹3,514.59", () => {
    const candles = run("10:00", [[295, 295.2, 294.6, 294.9], [294.9, 295, 291.8, 292.1]]);
    const r = resolveTrade("short", 296.5, 292, entryFill, candles, 0);
    assert.equal(r.status, "target");
    assert.equal(r.exitFill, 292);
    near(r.net, 3514.59);
  });

  it("fills a minute that opens above the stop at its open plus a tick", () => {
    const candles = run("10:00", [[295, 295.2, 294.6, 294.9], [297.0, 297.4, 296.8, 297.1]]);
    const r = resolveTrade("short", 296.5, 292, entryFill, candles, 0);
    assert.equal(r.exitFill, 297.1);
  });
});

// ---- bars, the forming bar, sessions -----------------------------------------------------

/** A full MCX session (09:00-23:54) of one-minute candles for `date`, price from `price(minuteOfDay)`. */
function session(date: string, price: (m: number) => number, volume = 10): Candle[] {
  const start = at(`${date}T00:00:00+05:30`);
  const out: Candle[] = [];
  for (let m = 9 * 60; m < 23 * 60 + 55; m++) {
    const o = price(m);
    const c = price(m + 1);
    out.push({ t: start + m * 60_000, o, h: Math.max(o, c) + 0.05, l: Math.min(o, c) - 0.05, c, v: volume });
  }
  return out;
}
const flat = (p: number) => () => p;

describe("bars", () => {
  const day = session("2026-11-17", flat(295));
  const after = at("2026-11-18T09:00:00+05:30");

  it("anchors the bins at 09:00: a 240-minute day has four (09:00, 13:00, 17:00, 21:00)", () => {
    const bars = aggregateBars(day, 240, after);
    assert.equal(bars.length, 4);
    assert.deepEqual(bars.map((b) => new Date(b.t + 19_800_000).toISOString().slice(11, 16)), ["09:00", "13:00", "17:00", "21:00"]);
  });

  it("makes a 15-minute bar from its fifteen candles: first open, highest high, lowest low, last close, summed volume", () => {
    const candles = session("2026-11-17", (m) => 295 + (m - 540) * 0.01);
    const bar = aggregateBars(candles, 15, after)[0];
    assert.equal(bar.o, candles[0].o);
    assert.equal(bar.c, candles[14].c);
    assert.equal(bar.h, Math.max(...candles.slice(0, 15).map((c) => c.h)));
    assert.equal(bar.l, Math.min(...candles.slice(0, 15).map((c) => c.l)));
    assert.equal(bar.v, 150);
    assert.equal(bar.end - bar.t, 15 * 60_000);
  });

  it("leaves no bar for a bin with no candles", () => {
    const gap = day.filter((c) => c.t < at("2026-11-17T10:00:00+05:30") || c.t >= at("2026-11-17T10:30:00+05:30"));
    const bars = aggregateBars(gap, 15, after);
    assert.ok(!bars.some((b) => b.t === at("2026-11-17T10:00:00+05:30") || b.t === at("2026-11-17T10:15:00+05:30")));
  });

  it("marks a bar complete once the next bin has begun, or the session has closed - never earlier", () => {
    const today = session("2026-11-18", flat(295)).filter((c) => c.t < at("2026-11-18T10:07:00+05:30"));
    const now = at("2026-11-18T10:07:30+05:30");
    const bars = aggregateBars(today, 5, now);
    assert.equal(bars.find((b) => b.t === at("2026-11-18T10:00:00+05:30"))!.complete, true); // ended 10:05
    assert.equal(bars.find((b) => b.t === at("2026-11-18T10:05:00+05:30"))!.complete, false); // forming
    const closed = aggregateBars(session("2026-11-18", flat(295)), 240, at("2026-11-18T23:56:00+05:30"));
    assert.equal(closed.at(-1)!.complete, true); // the 21:00 bin would end at 01:00 - the close completes it
  });

  it("drops completed special short sessions, but keeps today's partial one", () => {
    const full = session("2026-11-16", flat(295));
    const short = session("2026-11-17", flat(295)).slice(0, 300);
    const today = session("2026-11-18", flat(295)).slice(0, 50);
    const kept = usableSessions([...full, ...short, ...today], at("2026-11-18T10:00:00+05:30"));
    assert.deepEqual([...new Set(kept.map((c) => istDay(c.t)))], ["2026-11-16", "2026-11-18"]);
  });

  it("finds the first candle at or after a time", () => {
    assert.equal(lowerBound(day, day[10].t), 10);
    assert.equal(lowerBound(day, day[10].t + 1), 11);
    assert.equal(lowerBound(day, day.at(-1)!.t + 60_000), day.length);
  });

  it("counts the share of zero-volume minutes in the last hour", () => {
    const quiet = day.map((c, i) => (i % 5 === 0 ? { ...c, v: 0 } : c));
    near(thinTradingPct(quiet)!, 20, 1);
    assert.equal(thinTradingPct([]), null);
  });
});

describe("signals", () => {
  // A day that rises for two hours then falls: HA flips green at the start (bar 1) and red some bars after the turn.
  const wave = (m: number) => (m < 11 * 60 ? 295 + (m - 540) * 0.02 : 295 + 2.4 - (m - 660) * 0.03);
  const days = [session("2026-11-16", wave), session("2026-11-17", wave)].flat();
  const now = at("2026-11-18T09:00:00+05:30");

  it("reports the colour, the bars since the last flip, and whether the latest completed bar is the flip", () => {
    const { overview } = analyseTimeframe(days, 15, now);
    assert.ok(overview.green !== null);
    assert.ok(overview.barsSinceFlip !== null && overview.barsSinceFlip >= 0);
    assert.equal(overview.fresh, overview.barsSinceFlip === 0);
    assert.equal(overview.direction === null, !overview.fresh);
    assert.ok(overview.atr !== null && overview.atr > 0);
  });

  it("never signals on the forming bar: a colour change that has only just begun is not a flip", () => {
    // Fall through the whole of today's 10:00-10:05 bin: its candles flip HA to red, but it is not complete until 10:05.
    const prior = session("2026-11-17", (m) => 295 + (m - 540) * 0.01);
    const todayFall = session("2026-11-18", (m) => 305 - (m - 540) * 0.6).filter((c) => c.t < at("2026-11-18T10:03:00+05:30"));
    const early = analyseTimeframe([...prior, ...todayFall], 5, at("2026-11-18T10:03:30+05:30"));
    const later = analyseTimeframe([...prior, ...todayFall], 5, at("2026-11-18T10:06:00+05:30"));
    assert.ok(early.chart.at(-1)!.forming, "the last bar drawn is the forming one");
    assert.ok(early.overview.lastBarEnd! <= at("2026-11-18T10:00:00+05:30"), "the overview reads only completed bars");
    assert.ok(later.overview.lastBarEnd! > early.overview.lastBarEnd!);
  });

  it("sends the chart at most one forming bar, after the completed ones", () => {
    const { chart } = analyseTimeframe(days, 5, at("2026-11-17T12:02:00+05:30"));
    assert.equal(chart.filter((b) => b.forming).length, 1);
    assert.ok(chart.at(-1)!.forming);
    assert.ok(chart.slice(0, -1).every((b) => !b.forming));
  });

  it("has no overview for a timeframe with no completed bar", () => {
    const { overview } = analyseTimeframe([], 5, now);
    assert.deepEqual([overview.green, overview.barsSinceFlip, overview.atr, overview.fresh, overview.direction], [null, null, null, false, null]);
  });
});

describe("pivot levels", () => {
  it("works out the classic pivot, three resistances and three supports - H 324.30, L 322.10, C 323.10 (worked by hand)", () => {
    // P = 323.1667; R1 = 324.2333; S1 = 322.0333; R2 = 325.3667; S2 = 320.9667; R3 = 326.4333; S3 = 319.8333 - each to the 0.10 tick.
    assert.deepEqual(pivotLevels({ h: 324.3, l: 322.1, c: 323.1 }), { r3: 326.4, r2: 325.4, r1: 324.2, p: 323.2, s1: 322.0, s2: 321.0, s3: 319.8 });
  });

  it("keeps the levels in order, resistances above the pivot and supports below", () => {
    const l = pivotLevels({ h: 331.3, l: 322.1, c: 322.5 })!;
    assert.ok(l.r3 > l.r2 && l.r2 > l.r1 && l.r1 > l.p && l.p > l.s1 && l.s1 > l.s2 && l.s2 > l.s3);
  });

  it("has none for a bar with nothing usable in it", () => {
    assert.equal(pivotLevels({ h: NaN, l: 1, c: 1 }), null);
    assert.equal(pivotLevels({ h: 1, l: 2, c: 1.5 }), null); // a low above its high
  });

  it("is a single level, the price itself, for a bar that never moved", () => {
    const l = pivotLevels({ h: 322.5, l: 322.5, c: 322.5 })!;
    assert.deepEqual(Object.values(l), Array(7).fill(322.5));
  });
});

describe("the plain-candle reading", () => {
  const rising = (m: number) => 295 + (m - 540) * 0.02;
  const falling = (m: number) => 305 - (m - 540) * 0.02;
  const now = at("2026-11-18T09:00:00+05:30");

  it("is green on a rise and red on a fall, with the same ATR as the Heikin Ashi reading (same bars)", () => {
    const up = [session("2026-11-16", rising), session("2026-11-17", rising)].flat();
    const down = [session("2026-11-16", falling), session("2026-11-17", falling)].flat();
    assert.equal(analyseCandles(up, 15, now).green, true);
    assert.equal(analyseCandles(down, 15, now).green, false);
    assert.equal(analyseCandles(up, 15, now).atr, analyseTimeframe(up, 15, now).overview.atr);
  });

  it("is not a fresh signal while a colour has simply gone on", () => {
    const turn = (m: number) => (m < 11 * 60 ? 305 - (m - 540) * 0.03 : 305 - 5.4 + (m - 660) * 0.03);
    const days = [session("2026-11-16", turn), session("2026-11-17", turn)].flat();
    const o = analyseCandles(days, 5, now);
    assert.equal(o.green, true);
    assert.ok(o.barsSinceFlip !== null && o.barsSinceFlip > 0);
    assert.equal(o.fresh, false);
    assert.equal(o.direction, null);
  });

  it("carries the Heikin Ashi bar of the same moment on the Heikin Ashi reading only", () => {
    const days = [session("2026-11-16", rising), session("2026-11-17", rising)].flat();
    const ha = analyseTimeframe(days, 15, now).overview.lastHa;
    assert.ok(ha && ha.h >= ha.l);
    assert.equal(analyseCandles(days, 15, now).lastHa, null);
  });

  it("has no reading for a timeframe with no completed bar", () => {
    const o = analyseCandles([], 5, now);
    assert.deepEqual([o.green, o.barsSinceFlip, o.atr, o.fresh, o.direction], [null, null, null, false, null]);
  });
});

describe("entryWindow", () => {
  const tue = (hhmm: string) => at(`2026-11-17T${hhmm}:00+05:30`);
  it("is open from 09:00 to 22:30 IST, with the time to flat-by", () => {
    const w = entryWindow(tue("10:00"), true);
    assert.equal(w.state, "open");
    assert.equal(w.msToFlatBy, at("2026-11-17T23:20:00+05:30") - tue("10:00"));
    assert.equal(entryWindow(tue("22:30"), true).state, "open");
  });
  it("has no new entries after 22:30, and nothing open after 23:20", () => {
    assert.equal(entryWindow(tue("22:31"), true).state, "after-last-entry");
    assert.equal(entryWindow(tue("23:21"), true).state, "after-flat-by");
    assert.equal(entryWindow(tue("23:21"), true).msToFlatBy, null);
  });
  it("is closed when MCX is shut, and before the open", () => {
    assert.equal(entryWindow(tue("10:00"), false).state, "closed");
    assert.equal(entryWindow(tue("08:30"), true).state, "before-open");
    assert.equal(entryWindow(tue("23:56"), true).state, "closed");
  });
});

// ---- replay and counting -----------------------------------------------------------------

describe("countPlans (one position at a time)", () => {
  const plan = (entryT: number, exitT: number) => ({ entryT, exitT, status: "stop" as const, net: -1, day: "d" });
  it("counts a plan only if its entry is strictly after the previous counted exit", () => {
    const counted = countPlans([plan(10, 20), plan(15, 18), plan(20, 30), plan(21, 25), plan(31, 40)]);
    assert.deepEqual(counted.map((p) => p.entryT), [10, 21, 31]);
  });
  it("does not care what order it is given them in", () => {
    const a = countPlans([plan(21, 25), plan(10, 20), plan(31, 40), plan(15, 18)]);
    assert.deepEqual(a.map((p) => p.entryT), [10, 21, 31]);
  });
});

describe("statsOf and verdictFor", () => {
  const trades = (nets: number[], status: "target" | "stop" = "stop") => nets.map((net, i) => ({ net, status: i % 2 === 0 ? ("target" as const) : status, day: `2026-10-${String(1 + (i % 40)).padStart(2, "0")}` }));

  it("works out n, win %, average net, t and sessions", () => {
    const s = statsOf(trades([100, -50, 100, -50]));
    assert.equal(s.n, 4);
    assert.equal(s.winPct, 50);
    assert.equal(s.avgNet, 25);
    near(s.t!, 25 / (Math.sqrt(((75 ** 2) * 4) / 3) / 2), 1e-9);
    assert.equal(s.sessions, 4);
  });

  it("has nothing to say about no trades, and no t for one", () => {
    assert.deepEqual(statsOf([]), { n: 0, winPct: null, avgNet: null, t: null, sessions: 0 });
    assert.equal(statsOf(trades([5])).t, null);
  });

  it("gives no verdict below 100 plans or 30 sessions", () => {
    assert.equal(verdictFor({ n: 99, winPct: 40, avgNet: 10, t: 3, sessions: 40 }).kind, "not-enough");
    assert.equal(verdictFor({ n: 500, winPct: 40, avgNet: 10, t: 3, sessions: 29 }).kind, "not-enough");
    assert.match(verdictFor({ n: 50, winPct: 40, avgNet: 10, t: 3, sessions: 12 }).text, /Not enough data yet \(50 plans, 12 sessions\)/);
  });

  it("says 'no evidence of edge' below t = 2, 'positive, keep verifying' from it, and never that it works", () => {
    assert.equal(verdictFor({ n: 200, winPct: 40, avgNet: 10, t: 1.2, sessions: 31 }).text, "No evidence of edge");
    assert.equal(verdictFor({ n: 200, winPct: 40, avgNet: 10, t: 2.3, sessions: 31 }).text, "Positive, keep verifying");
    assert.equal(verdictFor({ n: 200, winPct: 40, avgNet: -50, t: -2.8, sessions: 31 }).text, "Negative after costs");
    for (const t of [-5, 0, 1.9, 2, 9]) assert.ok(!/works/i.test(verdictFor({ n: 200, winPct: 40, avgNet: 1, t, sessions: 31 }).text));
  });
});

describe("replay", () => {
  // Several sessions with swings big enough for HA flips and for stops and targets to be hit.
  const swing = (m: number) => 295 + 3 * Math.sin(m / 55) + 1.2 * Math.sin(m / 13);
  const history = ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-16", "2026-11-17"].flatMap((d) => session(d, swing));
  const now = at("2026-11-18T09:30:00+05:30");

  it("logs one plan per ratio for every flip with a valid entry minute, with the entry on the same day inside the window", () => {
    const plans = replayTimeframe(history, 15 as Timeframe, now);
    assert.ok(plans.length > 0);
    const ratios = new Set(plans.map((p) => p.ratio));
    assert.deepEqual([...ratios].sort(), [1, 1.5, 2, 3, 4, 5]);
    for (const p of plans) {
      assert.equal(istDay(p.entryT), p.day);
      assert.ok(((p.entryT - at(`${p.day}T00:00:00+05:30`)) / 60_000) <= 22 * 60 + 30);
      assert.ok(p.exitT >= p.entryT);
      assert.ok(p.side === "long" ? p.stop < p.entry && p.target > p.entry : p.stop > p.entry && p.target < p.entry);
    }
    const byFlip = new Map<number, number>();
    for (const p of plans) byFlip.set(p.barStart, (byFlip.get(p.barStart) ?? 0) + 1);
    assert.ok([...byFlip.values()].every((n) => n === 6), "one row per ratio per flip");
  });

  it("is repeatable: the same history gives the same replay, and running it twice adds nothing", () => {
    const a = buildReplay(history, [5, 15] as Timeframe[], now);
    const b = buildReplay(history, [5, 15] as Timeframe[], now);
    assert.deepEqual(a, b);
    assert.equal(a.sessions, 6);
  });

  it("counts every ratio's plans one at a time, never more than were logged, and keeps the stop's net loss a loss", () => {
    const r = buildReplay(history, [15] as Timeframe[], now);
    const plans = replayTimeframe(history, 15 as Timeframe, now);
    for (const ratio of [1, 1.5, 2, 3, 4, 5]) {
      const stats = r.timeframes[0].byRatio[String(ratio)];
      assert.ok(stats.n <= plans.filter((p) => p.ratio === ratio).length);
    }
    assert.ok(plans.filter((p) => p.status === "stop").every((p) => p.net < 0));
    assert.ok(plans.filter((p) => p.status === "target").every((p) => p.net > 0));
  });

  it("leaves out a session that was mostly padding (zero-volume) candles, and today", () => {
    const padded = session("2026-11-12", swing, 0);
    const mixed = history.filter((c) => istDay(c.t) !== "2026-11-12").concat(padded).sort((a, b) => a.t - b.t);
    const today = session("2026-11-18", swing).slice(0, 100);
    const r = buildReplay([...mixed, ...today], [15] as Timeframe[], at("2026-11-18T10:40:00+05:30"));
    assert.ok(!r.days.includes("2026-11-12"));
    assert.ok(!r.days.includes("2026-11-18"));
    assert.equal(r.sessions, 5);
  });

  it("lists the last flips newest first with how each ratio would have ended", () => {
    const r = buildReplay(history, [15] as Timeframe[], now);
    const recent = r.timeframes[0].recent;
    assert.ok(recent.length > 0 && recent.length <= 10);
    for (let i = 1; i < recent.length; i++) assert.ok(recent[i - 1].barStart > recent[i].barStart);
    assert.ok(Object.keys(recent[0].outcomes).length === 6);
  });

  it("has costs in it: every costed outcome differs from the gross by the fees (a target is never worth its gross)", () => {
    const plans = replayTimeframe(history, 15 as Timeframe, now).filter((p) => p.status === "target");
    assert.ok(plans.length > 0);
    for (const p of plans) {
      const gross = Math.abs(p.target - p.entry) * LOT + COSTS.slippageTicks * 0; // the target fills with no slippage
      const entryFill = p.side === "long" ? p.entry + TICK : p.entry - TICK;
      const grossFromFill = (p.side === "long" ? p.target - entryFill : entryFill - p.target) * LOT;
      assert.ok(p.net < grossFromFill && p.net > grossFromFill - 200, `${p.net} vs ${grossFromFill} (${gross})`);
    }
  });
});
