/**
 * The Live Portfolio's headline figures - what the open positions are worth and what they made - in one place, so the page and the
 * Dashboard can never disagree. Pure: no React, no network.
 */

import { calculateTodayPnl, isFutureEntry, isTrackedEntry, legSnapshotKey, type PortfolioRow } from "@/lib/calculatePortfolio";
import { DEFAULT_LOT_SIZES } from "@/lib/types";
import type { UpstoxPosition } from "@/lib/upstox/types";
import { positionContractKey, positionDayPnl } from "@/lib/upstoxSync";

export type PortfolioStats = {
  /** The options' premium value; null for a book with no option in it (a futures-only book has no premium to value, and "₹0" would read as worthless). */
  value: number | null;
  /** Live P&L of every open row, summed. livePnl is already sign-correct for both sides, so it is added as it is. */
  unrealizedPnl: number;
  /** Today's P&L; null when nothing has anything to measure against (e.g. every price is from an earlier session). */
  todayPnl: number | null;
  /** The part of `todayPnl` already booked: positions squared off today. */
  bookedToday: number;
};

/**
 * `todaysPositions` are today's Upstox positions when there are some - they also cover what was squared off today, which the open
 * rows no longer show - with each open contract marked at the live LTP the rows carry. Otherwise today's P&L falls back to the open
 * rows measured from the previous close (or the entry price, if opened today). `today` is the device's calendar date, yyyy-mm-dd.
 */
export function computePortfolioStats(rows: readonly PortfolioRow[], todaysPositions: readonly UpstoxPosition[] | null, today: string): PortfolioStats {
  // "Total Value" is the options' premium value. A future's price is an index level - a contract worth a few lakh
  // of rupees of exposure, not of premium - so adding it in would drown the figure; its P&L still counts below.
  let value = 0;
  let unrealizedPnl = 0;
  for (const row of rows) {
    const qty = row.entry.lots * DEFAULT_LOT_SIZES[row.entry.instrument];
    unrealizedPnl += row.livePnl ?? 0;
    if (isFutureEntry(row.entry)) continue;
    value += (row.liveLtp ?? row.entryPrice) * qty;
  }

  let todayPnl: number | null = null;
  let bookedToday = 0;
  if (todaysPositions && todaysPositions.length > 0) {
    const liveLtpByContract = new Map<string, number>();
    for (const row of rows) {
      if (row.status === "ok" && row.liveLtp != null && isTrackedEntry(row.entry)) {
        liveLtpByContract.set(legSnapshotKey(row.entry), row.liveLtp);
      }
    }
    for (const position of todaysPositions) {
      const pnl = positionDayPnl(position, liveLtpByContract.get(positionContractKey(position)) ?? null);
      if (pnl === null) continue;
      todayPnl = (todayPnl ?? 0) + pnl;
      if (position.quantity === 0) bookedToday += pnl;
    }
  } else {
    for (const row of rows) {
      const rowToday = calculateTodayPnl(row, today);
      if (rowToday !== null) todayPnl = (todayPnl ?? 0) + rowToday;
    }
  }

  const hasOptions = rows.some((row) => !isFutureEntry(row.entry));
  return { value: hasOptions ? value : null, unrealizedPnl, todayPnl, bookedToday };
}
