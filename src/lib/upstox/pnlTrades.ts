/**
 * Pure: turns the rows of Upstox's trade-wise P&L report into the closed round
 * trips the Trade Entries journal records. No fetching - the pnl-report route
 * pulls the F&O and MCX reports and the trade history, this reads them.
 *
 * Upstox lists one row per matched fill; rows of the same contract opened and
 * closed on the same two dates are merged into one trade. The report has no
 * notion of which leg came first, so that's read off the dates - or, for a
 * same-day round trip, off the exchange trade ids in the trade history.
 *
 * The indices and MCX count differently, and the whole module hangs on it:
 *   - NSE / BSE rows: `quantity` is in units (65 for one Nifty lot), and
 *     `buy_amount` is price x units.
 *   - MCX rows: `quantity` is in lots, and `buy_amount` is price x lots x the
 *     contract multiplier (a 1-lot crude buy at 365.4 is amount 36,540).
 * Rows are brought to units here so the rest of the app, which stores lots and a
 * per-unit price, reads both alike.
 */

import { round2 } from "@/lib/calculateTrade";
import {
  DEFAULT_LOT_SIZES,
  INSTRUMENTS,
  isCommodityInstrument,
  type IndexInstrument,
  type Instrument,
  type TradeEntryOptionType,
} from "@/lib/types";
import { compareTradeIds, num, type HistoricalFill } from "@/lib/upstox/api";
import type { UpstoxClosedTrade } from "@/lib/upstox/types";

/** The report's own name for each underlying (e.g. "NIFTY 09 Nov 2026 PE 23400", "CRUDEOIL 17 Nov 2026 CE 7800") - the same as ours. */
const INSTRUMENT_BY_REPORT_NAME: Record<string, Instrument> = Object.fromEntries(INSTRUMENTS.map((i) => [i, i] as const));

/**
 * Lot sizes each index traded at before today's (DEFAULT_LOT_SIZES), most
 * recent first — the report only has quantities, and an older trade's lots
 * are only right against the lot size of its day. Best effort: the first size
 * the quantity divides evenly by wins. P&L doesn't depend on it, since it's
 * taken from Upstox's own amounts. (MCX counts lots to begin with.)
 */
const EARLIER_LOT_SIZES: Record<IndexInstrument, number[]> = {
  NIFTY: [75, 25, 50],
  BANKNIFTY: [35, 15, 25],
  SENSEX: [10, 15],
};

const MONTHS: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

const OPTION_SCRIP = /^(.+?)\s+(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(CE|PE)\s+(\d+(?:\.\d+)?)$/i;
const FUTURE_SCRIP = /^(.+?)\s+(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\b/;

export type ParsedScrip = {
  name: string;
  instrument: Instrument | null;
  expiry: string;
  optionType: TradeEntryOptionType | null;
  strike: number | null;
};

function toExpiry(day: string, month: string, year: string): string | null {
  const mm = MONTHS[month.toUpperCase()];
  return mm ? `${year}-${mm}-${day.padStart(2, "0")}` : null;
}

export function parseScrip(scrip: string, tradeType: unknown): ParsedScrip | null {
  const option = tradeType === "OPT" ? OPTION_SCRIP.exec(scrip.trim()) : null;
  if (option) {
    const [, name, day, month, year, type, strike] = option;
    const expiry = toExpiry(day, month, year);
    if (!expiry) return null;
    return {
      name,
      instrument: INSTRUMENT_BY_REPORT_NAME[name.toUpperCase()] ?? null,
      expiry,
      optionType: type.toUpperCase() as TradeEntryOptionType,
      strike: Number(strike),
    };
  }
  const future = tradeType === "FUT" ? FUTURE_SCRIP.exec(scrip.trim()) : null;
  if (future) {
    const [, name, day, month, year] = future;
    const expiry = toExpiry(day, month, year);
    if (!expiry) return null;
    return { name, instrument: INSTRUMENT_BY_REPORT_NAME[name.toUpperCase()] ?? null, expiry, optionType: null, strike: null };
  }
  return null;
}

/** "30-10-2026" → "2026-10-30". */
function reportDate(value: unknown): string | null {
  const match = typeof value === "string" ? /^(\d{2})-(\d{2})-(\d{4})$/.exec(value) : null;
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

/** What a report row's `quantity` stands for, in units: MCX counts lots, the indices already count units. */
export function reportQuantityInUnits(instrument: Instrument, quantity: number): number {
  return isCommodityInstrument(instrument) ? quantity * DEFAULT_LOT_SIZES[instrument] : quantity;
}

function lotsFor(instrument: Instrument, units: number): number {
  if (isCommodityInstrument(instrument)) return Math.max(1, Math.round(units / DEFAULT_LOT_SIZES[instrument]));
  for (const size of [DEFAULT_LOT_SIZES[instrument], ...EARLIER_LOT_SIZES[instrument]]) {
    if (units % size === 0) return units / size;
  }
  return Math.max(1, Math.round(units / DEFAULT_LOT_SIZES[instrument]));
}

export type ReportGroup = ParsedScrip & {
  instrument: Instrument;
  buyDate: string;
  sellDate: string;
  /** In units, whatever the segment counts in. */
  quantity: number;
  buyAmount: number;
  sellAmount: number;
};

export type GroupedReport = {
  /** Keyed by contract + the two dates - stable within a report. */
  groups: Map<string, ReportGroup>;
  /** Rows in underlyings the journal doesn't track (stock options, silver, ...), with their names. */
  otherCount: number;
  otherNames: Set<string>;
  /** Sell minus buy over every row, the left-out ones included - the scope Upstox's charges are quoted over. */
  grossPnl: number;
};

/** Merges report rows (from any mix of segments) into one group per contract and pair of dates. */
export function groupReportRows(rows: Record<string, unknown>[]): GroupedReport {
  const groups = new Map<string, ReportGroup>();
  const otherNames = new Set<string>();
  let otherCount = 0;
  let grossPnl = 0;

  for (const row of rows) {
    grossPnl += num(row.sell_amount) - num(row.buy_amount);
    const parsed = typeof row.scrip_name === "string" ? parseScrip(row.scrip_name, row.trade_type) : null;
    const buyDate = reportDate(row.buy_date);
    const sellDate = reportDate(row.sell_date);
    const rowQuantity = num(row.quantity);
    if (!parsed?.instrument || !buyDate || !sellDate || !(rowQuantity > 0)) {
      otherCount++;
      otherNames.add(parsed?.name ?? (typeof row.scrip_name === "string" ? row.scrip_name : "Unknown"));
      continue;
    }
    const key = [parsed.instrument, parsed.expiry, parsed.strike ?? "FUT", parsed.optionType ?? "", buyDate, sellDate].join("|");
    const group = groups.get(key) ?? { ...parsed, instrument: parsed.instrument, buyDate, sellDate, quantity: 0, buyAmount: 0, sellAmount: 0 };
    group.quantity += reportQuantityInUnits(parsed.instrument, rowQuantity);
    group.buyAmount += num(row.buy_amount);
    group.sellAmount += num(row.sell_amount);
    groups.set(key, group);
  }
  return { groups, otherCount, otherNames, grossPnl: round2(grossPnl) };
}

/**
 * Which leg of a same-day round trip came first: its earliest fill that day
 * (exchange trade ids rise through the session). Null when the history has no
 * matching fill - the caller then falls back to "buy".
 */
export function firstSideOf(group: ReportGroup, fills: HistoricalFill[]): "BUY" | "SELL" | null {
  const first = fills
    .filter(
      (f) =>
        f.date === group.buyDate &&
        f.symbol === group.instrument &&
        f.expiry === group.expiry &&
        (group.optionType === null || (f.optionType === group.optionType && f.strike === group.strike)),
    )
    .sort((a, b) => compareTradeIds(a.tradeId, b.tradeId))[0];
  return first?.side ?? null;
}

/** The merged groups as journal-shaped trades, oldest entry first. `firstSides` is firstSideOf's answer per group key. */
export function tradesFromGroups(groups: Map<string, ReportGroup>, firstSides: Map<string, "BUY" | "SELL">): UpstoxClosedTrade[] {
  const trades: UpstoxClosedTrade[] = [...groups].map(([key, g]) => {
    const sellFirst = g.sellDate < g.buyDate || (g.sellDate === g.buyDate && firstSides.get(key) === "SELL");
    return {
      key,
      instrument: g.instrument,
      strike: g.strike,
      optionType: g.optionType,
      expiry: g.expiry,
      side: sellFirst ? "sell" : "buy",
      entryDate: sellFirst ? g.sellDate : g.buyDate,
      closingDate: sellFirst ? g.buyDate : g.sellDate,
      quantity: g.quantity,
      lots: lotsFor(g.instrument, g.quantity),
      buyPrice: round2(g.buyAmount / g.quantity),
      sellPrice: round2(g.sellAmount / g.quantity),
      pnl: round2(g.sellAmount - g.buyAmount),
    };
  });
  trades.sort((a, b) => (a.entryDate !== b.entryDate ? (a.entryDate < b.entryDate ? -1 : 1) : a.key < b.key ? -1 : 1));
  return trades;
}
