/** What each timeframe says right now, from its completed Heikin Ashi bars or its plain candles - and where the trading day stands for acting on it. */

import { aggregateBars, istDayStart, minuteOfDay, sessionCloseMs } from "@/lib/natgasPlanner/bars";
import { CHART_BARS, SESSION, type Timeframe } from "@/lib/natgasPlanner/config";
import { atr as atrSeries, flips, heikinAshi } from "@/lib/natgasPlanner/indicators";
import type { Bar, Candle, HaBar, Side } from "@/lib/natgasPlanner/types";

export type TfOverview = {
  tf: Timeframe;
  /** The latest completed bar's colour (Heikin Ashi, or the candle's own); null while the timeframe has no completed bar. */
  green: boolean | null;
  /** Completed bars since the last colour change (0: the latest completed bar is the flip); null when there has been none. */
  barsSinceFlip: number | null;
  /** The flip is on the latest completed bar. A flip is known only at its bar's close. */
  fresh: boolean;
  /** The side of a fresh flip; null otherwise. */
  direction: Side | null;
  /** ATR(14) at the latest completed bar; null with fewer than 14 bars. */
  atr: number | null;
  /** The latest completed bar's own open, high, low and close - the plain candle's, whichever way it is coloured - and when that bar ended. */
  lastOpen: number | null;
  lastHigh: number | null;
  lastLow: number | null;
  lastClose: number | null;
  lastBarEnd: number | null;
  /** The same bar as Heikin Ashi draws it (null in the plain-candle reading, and while there is no completed bar). */
  lastHa: { o: number; h: number; l: number; c: number } | null;
};

export type ChartBar = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  /** Heikin Ashi values for the same bar. */
  ha: { o: number; h: number; l: number; c: number; green: boolean };
  forming: boolean;
};

/** The flips, the latest completed bar and the ATR read the same way whichever colours the bars are given. */
function overviewOf(tf: Timeframe, bars: readonly Bar[], colours: readonly { green: boolean }[], atr: readonly (number | null)[], ha: readonly HaBar[] | null): { overview: TfOverview; lastDone: number } {
  const flipList = flips(colours);

  let lastDone = -1;
  for (let i = bars.length - 1; i >= 0; i--) {
    if (bars[i].complete) {
      lastDone = i;
      break;
    }
  }
  const lastFlip = [...flipList].reverse().find((f) => f.index <= lastDone) ?? null;
  const fresh = lastFlip !== null && lastFlip.index === lastDone;

  const overview: TfOverview = {
    tf,
    green: lastDone >= 0 ? colours[lastDone].green : null,
    barsSinceFlip: lastFlip ? lastDone - lastFlip.index : null,
    fresh,
    direction: fresh && lastFlip ? lastFlip.side : null,
    atr: lastDone >= 0 ? atr[lastDone] : null,
    lastOpen: lastDone >= 0 ? bars[lastDone].o : null,
    lastHigh: lastDone >= 0 ? bars[lastDone].h : null,
    lastLow: lastDone >= 0 ? bars[lastDone].l : null,
    lastClose: lastDone >= 0 ? bars[lastDone].c : null,
    lastBarEnd: lastDone >= 0 ? bars[lastDone].end : null,
    lastHa: ha && lastDone >= 0 ? { o: ha[lastDone].o, h: ha[lastDone].h, l: ha[lastDone].l, c: ha[lastDone].c } : null,
  };
  return { overview, lastDone };
}

/** The overview for one timeframe, and the bars to draw (the last completed ones plus the forming bar, kept apart from the signal). */
export function analyseTimeframe(candles: readonly Candle[], tf: Timeframe, nowMs: number): { overview: TfOverview; chart: ChartBar[] } {
  const bars = aggregateBars(candles, tf, nowMs);
  const ha = heikinAshi(bars);
  const { overview, lastDone } = overviewOf(tf, bars, ha, atrSeries(bars), ha);

  const from = Math.max(0, lastDone - CHART_BARS + 1);
  const chart: ChartBar[] = [];
  for (let i = from; i < bars.length; i++) {
    if (i > lastDone + 1) break; // at most the one forming bar after the last completed one
    const b = bars[i];
    chart.push({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, ha: { o: ha[i].o, h: ha[i].h, l: ha[i].l, c: ha[i].c, green: ha[i].green }, forming: !b.complete });
  }
  return { overview, chart };
}

/**
 * The same reading from the plain candles instead of Heikin Ashi - each bar's colour is its own and nothing else's: green when it closes
 * above its open, red when it closes below. One that closes where it opened (a doji) takes its colour from its close against the
 * previous bar's close, as a chart does; only when that is level too does it keep the colour before it (the very first, red). A colour
 * change on the latest completed bar is the signal, exactly as with Heikin Ashi - the ATR is the same, since it is taken from the same bars.
 */
export function analyseCandles(candles: readonly Candle[], tf: Timeframe, nowMs: number): TfOverview {
  const bars = aggregateBars(candles, tf, nowMs);
  const colours: { green: boolean }[] = [];
  bars.forEach((b, i) => {
    const prevClose = i > 0 ? bars[i - 1].c : null;
    const carried = colours.at(-1)?.green ?? false;
    const green = b.c > b.o ? true : b.c < b.o ? false : prevClose !== null && b.c !== prevClose ? b.c > prevClose : carried;
    colours.push({ green });
  });
  return overviewOf(tf, bars, colours, atrSeries(bars), null).overview;
}

export type EntryWindow = {
  /** open: a new plan may be entered; the other states grey the plan out. */
  state: "open" | "before-open" | "after-last-entry" | "after-flat-by" | "closed";
  /** When open positions should be flat, and how long until then (null once passed or when MCX is shut). */
  flatByMs: number | null;
  msToFlatBy: number | null;
};

/** Where the day stands: inside the entry window (open to 22:30 IST), past the last entry, past the flat-by time, or MCX shut. */
export function entryWindow(nowMs: number, marketOpen: boolean): EntryWindow {
  const dayStart = istDayStart(nowMs);
  const flatByMs = dayStart + SESSION.flatBy * 60_000;
  const minute = minuteOfDay(nowMs);
  const closeMin = Math.floor((sessionCloseMs(nowMs) - dayStart) / 60_000);
  if (!marketOpen || minute >= closeMin) return { state: "closed", flatByMs: null, msToFlatBy: null };
  if (minute < SESSION.open) return { state: "before-open", flatByMs, msToFlatBy: flatByMs - nowMs };
  if (minute > SESSION.flatBy) return { state: "after-flat-by", flatByMs: null, msToFlatBy: null };
  if (minute > SESSION.lastEntry) return { state: "after-last-entry", flatByMs, msToFlatBy: flatByMs - nowMs };
  return { state: "open", flatByMs, msToFlatBy: flatByMs - nowMs };
}
