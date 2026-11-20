/**
 * Pure: turns the rows of Upstox's trade-wise P&L report into the trades the Reports page is built from. No
 * fetching - the pnl-trades route pulls the rows, this reads them.
 *
 * Reports follows Upstox's own report, so one report row is one trade, exactly as Upstox counts them (a 3-lot exit
 * that filled in three pieces is three rows, three trades). That is deliberately not what Trade Entries' sync does,
 * which merges the pieces into one journal entry (pnlTrades.ts).
 *
 * Every underlying Upstox reports is kept - FINNIFTY, stock options, equity - not just the ones the journal tracks.
 * Each row says when it was bought and when it was sold but not which came first, so the side is read off the dates:
 * bought first is a "buy", sold first (a short) is a "sell", and a trade opened and closed the same day has no way to
 * tell, so its side is null.
 *
 * The fields are snake_case on purpose: a trade then has the shape of a journal entry (see ReportTrade in
 * calculateReports.ts), so one set of report maths reads both.
 */

import { round2 } from "@/lib/calculateTrade";
import { num } from "@/lib/upstox/api";
import { parseScrip, reportDate } from "@/lib/upstox/pnlTrades";
import type { UpstoxPnlSegment, UpstoxReportTrade } from "@/lib/upstox/types";

/** "NIFTY" for a bare name, a trailing " FUT" dropped. */
function futureName(scrip: string): string {
  return scrip.replace(/\s+FUT$/i, "").trim() || scrip;
}

/**
 * One report row as a trade, or null when it can't be read (no quantity, or dates that aren't dates). `index` is the
 * row's place in its segment's report - it only keeps ids apart for rows that are otherwise identical, and keeps their order.
 */
export function reportRowToTrade(row: Record<string, unknown>, segment: UpstoxPnlSegment, index: number): UpstoxReportTrade | null {
  const buyDate = reportDate(row.buy_date);
  const sellDate = reportDate(row.sell_date);
  const quantity = num(row.quantity);
  if (!buyDate || !sellDate || !(quantity > 0)) return null;

  const scrip = typeof row.scrip_name === "string" && row.scrip_name.trim() ? row.scrip_name.trim() : "Unknown";
  const buyAmount = round2(num(row.buy_amount));
  const sellAmount = round2(num(row.sell_amount));
  const parsed = parseScrip(scrip, row.trade_type);

  let underlying = scrip;
  let label = scrip;
  let strike: number | null = null;
  let optionType: UpstoxReportTrade["option_type"] = null;
  let expiry: string | null = null;
  if (parsed?.optionType && parsed.strike !== null) {
    underlying = parsed.name;
    strike = parsed.strike;
    optionType = parsed.optionType;
    expiry = parsed.expiry;
    label = `${parsed.name} ${parsed.strike} ${parsed.optionType}`;
  } else if (row.trade_type === "FUT") {
    underlying = parsed?.name ?? futureName(scrip);
    expiry = parsed?.expiry ?? null;
    label = `${underlying} FUT`;
  }

  const closingDate = buyDate > sellDate ? buyDate : sellDate;
  return {
    id: `${segment}|${index}|${scrip}|${buyDate}|${sellDate}`,
    segment,
    instrument: underlying,
    label,
    strike_price: strike,
    option_type: optionType,
    expiry_date: expiry,
    entry_date: buyDate < sellDate ? buyDate : sellDate,
    closing_date: closingDate,
    side: buyDate < sellDate ? "buy" : sellDate < buyDate ? "sell" : null,
    quantity,
    buy_price: round2(num(row.buy_average)),
    sell_price: round2(num(row.sell_average)),
    buy_amount: buyAmount,
    sell_amount: sellAmount,
    pnl: round2(sellAmount - buyAmount),
    status: "squared_off",
    // Orders trades of the same day the way the report listed them.
    created_at: `${closingDate}#${String(index).padStart(6, "0")}`,
  };
}

/** Every readable row of a segment's report as a trade, in the report's order; rows that can't be read are left out. */
export function reportRowsToTrades(rows: Record<string, unknown>[], segment: UpstoxPnlSegment): UpstoxReportTrade[] {
  const trades: UpstoxReportTrade[] = [];
  rows.forEach((row, index) => {
    const trade = reportRowToTrade(row, segment, index);
    if (trade) trades.push(trade);
  });
  return trades;
}
