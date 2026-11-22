/** IST day arithmetic, and building N-minute bars from one-minute candles. All timestamps are UTC milliseconds; all sessions are IST days. */

import { MIN_SESSION_CANDLES, SESSION, sessionCloseMinute } from "@/lib/natgasPlanner/config";
import type { Bar, Candle } from "@/lib/natgasPlanner/types";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 5.5 * 3_600_000;

/** 00:00 IST of the day `ms` falls in, as an instant. */
export const istDayStart = (ms: number): number => Math.floor((ms + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;
/** yyyy-mm-dd, IST. */
export const istDay = (ms: number): string => new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
/** Minutes since 00:00 IST. */
export const minuteOfDay = (ms: number): number => Math.floor((ms - istDayStart(ms)) / MINUTE_MS);
/** When MCX closes on the IST day `ms` falls in. */
export const sessionCloseMs = (ms: number): number => istDayStart(ms) + sessionCloseMinute(istDay(ms)) * MINUTE_MS;

/**
 * Groups ascending candles into bars of `tf` minutes anchored at the 09:00 open of each IST day. A bar is complete once the next
 * bin has begun or the session has closed - the forming bar is returned too (marked incomplete) but never signals. Empty bins don't exist.
 */
export function aggregateBars(candles: readonly Candle[], tf: number, nowMs: number): Bar[] {
  const bars: Bar[] = [];
  let current: Bar | null = null;
  let dayStart = Number.NaN;
  let day = "";
  let closeMs = 0;

  for (const c of candles) {
    if (!(c.t >= dayStart && c.t < dayStart + DAY_MS)) {
      dayStart = istDayStart(c.t);
      day = istDay(c.t);
      closeMs = sessionCloseMs(c.t);
    }
    const minute = (c.t - dayStart) / MINUTE_MS;
    if (minute < SESSION.open) continue;
    const start = dayStart + (SESSION.open + Math.floor((minute - SESSION.open) / tf) * tf) * MINUTE_MS;
    if (current && current.t === start) {
      if (c.h > current.h) current.h = c.h;
      if (c.l < current.l) current.l = c.l;
      current.c = c.c;
      current.v += c.v;
    } else {
      const end: number = start + tf * MINUTE_MS;
      current = { t: start, end, day, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v, complete: nowMs >= end || nowMs >= closeMs };
      bars.push(current);
    }
  }
  return bars;
}

/** Where each IST day's candles sit in an ascending series: [from, to) indices. One date is built per day, not per candle. */
export function dayRanges(candles: readonly Candle[]): { day: string; from: number; to: number }[] {
  const out: { day: string; from: number; to: number }[] = [];
  let dayEnd = -Infinity;
  for (let i = 0; i < candles.length; i++) {
    if (candles[i].t >= dayEnd) {
      const start = istDayStart(candles[i].t);
      dayEnd = start + DAY_MS;
      out.push({ day: istDay(start), from: i, to: i });
    }
    out[out.length - 1].to = i + 1;
  }
  return out;
}

/**
 * The candles that count: every session but a completed one with too few candles (a special short session). Today's partial session
 * stays - it is the live one.
 */
export function usableSessions(candles: readonly Candle[], nowMs: number): Candle[] {
  const today = istDay(nowMs);
  const out: Candle[] = [];
  for (const r of dayRanges(candles)) {
    if (r.day === today || r.to - r.from >= MIN_SESSION_CANDLES) for (let i = r.from; i < r.to; i++) out.push(candles[i]);
  }
  return out;
}

/** Index of the first candle at or after `t` (candles ascending), or `candles.length`. */
export function lowerBound(candles: readonly Candle[], t: number): number {
  let lo = 0;
  let hi = candles.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Share (0-100) of zero-volume candles among the last `count` - the padding Upstox sends for a minute nothing traded. */
export function thinTradingPct(candles: readonly Candle[], count = 60): number | null {
  const last = candles.slice(-count);
  if (last.length === 0) return null;
  return (last.filter((c) => c.v === 0).length / last.length) * 100;
}
