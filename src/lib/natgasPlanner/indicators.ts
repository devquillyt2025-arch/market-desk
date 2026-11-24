/** Heikin Ashi and Wilder's ATR over bars. Pure and continuous across days: the caller passes the whole series. */

import { ATR_PERIOD } from "@/lib/natgasPlanner/config";
import type { Bar, HaBar } from "@/lib/natgasPlanner/types";

type Ohlc = { t: number; o: number; h: number; l: number; c: number };

/**
 * ha_close = (o+h+l+c)/4; ha_open starts at (o+c)/2 and then follows (previous ha_open + previous ha_close)/2. Green when
 * ha_close is above ha_open, otherwise red (equal counts as red). The high and low are the usual HA ones, for drawing.
 */
export function heikinAshi(bars: readonly Ohlc[]): HaBar[] {
  const out: HaBar[] = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const c = (b.o + b.h + b.l + b.c) / 4;
    const o = i === 0 ? (b.o + b.c) / 2 : (out[i - 1].o + out[i - 1].c) / 2;
    out.push({ t: b.t, o, h: Math.max(b.h, o, c), l: Math.min(b.l, o, c), c, green: c > o });
  }
  return out;
}

/**
 * Wilder's ATR, one value per bar (null until `period` true ranges exist). A bar's true range is max(H-L, |H-prevClose|, |L-prevClose|),
 * with the previous close used only within the same day - the first bar of a day is just H-L. The first ATR is the plain mean of the
 * first `period` true ranges, then ATR = (previous ATR x (period-1) + TR) / period.
 */
export function atr(bars: readonly (Ohlc & { day: string })[], period = ATR_PERIOD): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  let value: number | null = null;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const prev = i > 0 && bars[i - 1].day === b.day ? bars[i - 1] : null;
    const tr = prev ? Math.max(b.h - b.l, Math.abs(b.h - prev.c), Math.abs(b.l - prev.c)) : b.h - b.l;
    if (i < period) {
      sum += tr;
      if (i === period - 1) value = sum / period;
    } else {
      value = ((value as number) * (period - 1) + tr) / period;
    }
    out.push(i >= period - 1 ? value : null);
  }
  return out;
}

export type Flip = { index: number; side: "long" | "short" };

/** Every bar whose colour differs from the one before it: a green flip is a long signal, a red flip a short. Heikin Ashi bars or plain candles - only the colour is read. */
export function flips(ha: readonly { green: boolean }[]): Flip[] {
  const out: Flip[] = [];
  for (let i = 1; i < ha.length; i++) {
    if (ha[i].green !== ha[i - 1].green) out.push({ index: i, side: ha[i].green ? "long" : "short" });
  }
  return out;
}

/** Only the finished bars. A forming bar can still change colour, so it must never be read as a signal. */
export const completed = <T extends Bar>(bars: readonly T[]): T[] => bars.filter((b) => b.complete);
