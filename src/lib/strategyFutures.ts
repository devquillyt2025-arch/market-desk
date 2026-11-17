/**
 * What an index future needs from an option chain and its own quote - pure, no React or fetching. A future has no
 * strike or implied volatility of its own, so it is measured against the index: the level comes from the chain of
 * the future's expiry, the volatility is the at-the-money one of that same chain, and the future's gap to the index
 * (its "basis") is its own last price less that level. Live Portfolio and the Analysis tab read them the same way.
 */

import type { UpstoxOptionChainStrike } from "@/lib/upstox/types";

/** Every strike row in a chain carries the same underlying spot, so any one that has it will do. */
export function spotOfRows(rows: UpstoxOptionChainStrike[] | undefined): number | null {
  const spot = rows?.find((row) => row.underlying_spot_price != null && row.underlying_spot_price > 0)?.underlying_spot_price;
  return spot ?? null;
}

/**
 * The volatility the options at the money trade at: the average of the call's and the put's IV at the strike nearest
 * `spot`. A future has no IV of its own, and this is the one the options of its own expiry trade at.
 */
export function atmIvOfRows(rows: UpstoxOptionChainStrike[] | undefined, spot: number | null): number | null {
  if (!rows || spot == null) return null;
  let best: { distance: number; iv: number } | null = null;
  for (const row of rows) {
    const strike = Number(row.strike_price);
    if (!Number.isFinite(strike)) continue;
    const ivs = [row.call_options?.option_greeks?.iv, row.put_options?.option_greeks?.iv].filter((v): v is number => v != null && v > 0);
    if (ivs.length === 0) continue;
    const distance = Math.abs(strike - spot);
    if (best === null || distance < best.distance) best = { distance, iv: ivs.reduce((a, b) => a + b, 0) / ivs.length };
  }
  return best?.iv ?? null;
}

/** How far a future trades above (below, if negative) the index: its last price less the index level. Null when either is missing. */
export function futureBasisOf(futureLtp: number | null | undefined, indexSpot: number | null | undefined): number | null {
  if (futureLtp == null || indexSpot == null || !(futureLtp > 0) || !(indexSpot > 0)) return null;
  return futureLtp - indexSpot;
}
