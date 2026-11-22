/**
 * What an MCX commodity's one-day move is measured against. Pure - no network.
 *
 * Upstox's own "previous close" (`cp`) is right while the session is open, but after the 23:55 close it is reset - for some
 * contracts to that day's settlement price, for others not yet - so the same metal can read -4.4% in one contract and +0.1% in
 * another (on 21 Nov 2026: Gold +0.14% against a real -4.32%, Silver +0.74% against -5.45%; ten of 25 tiles were off by more
 * than 0.3 points). The price history has no such quirk: the move of the latest session is its close against the close of the
 * session before it. That is what this returns, and it equals `cp` wherever `cp` is right.
 *
 * "The latest session" is the one the last trade belongs to: MCX never trades past midnight, so the IST date of the last trade
 * is its session - today while the market is open or just closed, Friday over a weekend.
 */

import { istDateString, addDays } from "@/lib/calculateStrategy";
import { closeOnOrBefore, type DailyClose } from "@/lib/upstox/dailyCloses";

/**
 * The close the latest price is compared against: the last close before the session of the last trade (`lastTradeMs`, epoch ms).
 * `closes` are the completed sessions before today, oldest first. Falls back to Upstox's `cp` when there is no usable last
 * trade or no history that far back (a contract that has just rolled has none), and to null when there is no `cp` either.
 */
export function sessionReference(input: { closes: DailyClose[]; lastTradeMs: number | null; cp: number | null }): number | null {
  const { closes, lastTradeMs, cp } = input;
  if (lastTradeMs !== null && Number.isFinite(lastTradeMs) && lastTradeMs > 1e12) {
    const reference = closeOnOrBefore(closes, addDays(istDateString(lastTradeMs), -1));
    if (reference !== null) return reference;
  }
  return typeof cp === "number" && cp > 0 ? cp : null;
}
