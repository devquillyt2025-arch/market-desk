/**
 * The natural gas planner's rules in one place: the contract, the sessions, the timeframes, the ratios and the cost model. Everything
 * the engine does is computed from these - change a rate here and every plan, stat and test fixture follows.
 */

import { DEFAULT_LOT_SIZES, mcxSessionCloseIst } from "@/lib/types";

/** mmBtu per lot, and the price step (10 paise). */
export const LOT = DEFAULT_LOT_SIZES.NATURALGAS;
export const TICK = 0.1;

/** The timeframes on offer, in minutes. Bars are anchored at the session open each day (240 gives 09:00, 13:00, 17:00, 21:00). */
export const TIMEFRAMES = [1, 2, 3, 5, 10, 15, 30, 60, 240] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];
export const isTimeframe = (n: number): n is Timeframe => (TIMEFRAMES as readonly number[]).includes(n);

/** Target to stop-distance ratios offered (1:r). */
export const RATIOS = [1, 1.5, 2, 3, 4, 5] as const;
export const DEFAULT_RATIO = 2;

export const ATR_PERIOD = 14;
/** The stop is this many ATRs unless the cost floor is wider; also what the replay uses. */
export const DEFAULT_ATR_MULT = 1.5;
export const ATR_MULT_RANGE = { min: 1, max: 3, step: 0.25 } as const;

/** Minutes since 00:00 IST. The close is not here: it moves with US daylight saving (23:30 or 23:55), see `sessionCloseMinute`. */
export const SESSION = { open: 9 * 60, lastEntry: 22 * 60 + 30, flatBy: 23 * 60 + 20 } as const;
/** A completed session with fewer one-minute candles than this is a special short session: left out of signals and statistics. */
export const MIN_SESSION_CANDLES = 380;
/** More than this share of zero-volume minutes in the last hour is "thin trading". */
export const THIN_TRADING_PCT = 10;
/** A replay session counts only if it traded in at least this share of its minutes - an early, quiet contract's padded candles are not a market. */
export const MIN_LIQUID_SHARE = 0.9;

/**
 * Assumed rates - check them against your contract note. Brokerage is per order (two orders a round trip); the others are shares
 * of traded value. Slippage is one tick against you on an entry, a stop exit and an end-of-day exit, none on a target (a limit order).
 */
export const COSTS = {
  brokeragePerOrder: 20,
  exchangeAndSebi: 0.000022,
  ctt: 0.0001,
  stamp: 0.00002,
  gst: 0.18,
  slippageTicks: 1,
  /** The stop is never tighter than the point where a round trip's costs are this share of the risk. */
  floorCostShare: 0.2,
  floorExtraTicks: 2,
} as const;

/** A replay shows a verdict only with this much evidence. */
export const VERDICT_MIN_PLANS = 100;
export const VERDICT_MIN_SESSIONS = 30;

/** How much history the replay reads: the contract's last six weeks or so, in two of Upstox's 27-day requests. */
export const HISTORY_DAYS = 45;
/** The most completed bars sent for the chart. */
export const CHART_BARS = 90;

export function sessionCloseMinute(day: string): number {
  const [h, m] = mcxSessionCloseIst(day).split(":").map(Number);
  return h * 60 + m;
}
