/**
 * Support and resistance from a bar's high, low and close - the classic floor-trader pivot points, which any chart package draws:
 *
 *   P  = (H + L + C) / 3
 *   R1 = 2P - L          S1 = 2P - H
 *   R2 = P + (H - L)     S2 = P - (H - L)
 *   R3 = H + 2(P - L)    S3 = L - 2(H - P)
 *
 * Worked out the same way for a plain candle and for a Heikin Ashi bar (each with its own high, low and close), then rounded to the
 * contract's tick. They are reference levels where a market has often paused or turned - not a forecast, and not a signal.
 */

import { roundToTick } from "@/lib/natgasPlanner/costs";

export type PivotLevels = { r3: number; r2: number; r1: number; p: number; s1: number; s2: number; s3: number };

export function pivotLevels(bar: { h: number; l: number; c: number }): PivotLevels | null {
  const { h, l, c } = bar;
  if (![h, l, c].every(Number.isFinite) || h < l) return null;
  const p = (h + l + c) / 3;
  return {
    r3: roundToTick(h + 2 * (p - l)),
    r2: roundToTick(p + (h - l)),
    r1: roundToTick(2 * p - l),
    p: roundToTick(p),
    s1: roundToTick(2 * p - h),
    s2: roundToTick(p - (h - l)),
    s3: roundToTick(l - 2 * (h - p)),
  };
}
