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
/**
 * What Upstox actually calls a future in the report: the bare underlying ("NIFTY"), with no expiry
 * month - unlike an option's "NIFTY 22 Sep 2026 PE 23650". Seen on the real row of a Nifty future
 * closed on 18 Nov 2026; the dated form above is kept in case some segment still sends it.
 */
const BARE_FUTURE_SCRIP = /^([A-Za-z0-9&-]+?)(?:\s+FUT)?$/i;

export type ParsedScrip = {
  name: string;
  instrument: Instrument | null;
  /** Null for a future whose expiry the report doesn't name and the trade history couldn't supply. */
  expiry: string | null;
  optionType: TradeEntryOptionType | null;
  strike: number | null;
};

function toExpiry(day: string, month: string, year: string): string | null {
  const mm = MONTHS[month.toUpperCase()];
  return mm ? `${year}-${mm}-${day.padStart(2, "0")}` : null;
}

/**
 * `futureExpiry` is the expiry worked out for a future that has none in its name
 * (see withFutureExpiries) - ignored for options and for futures that name their month.
 */
export function parseScrip(scrip: string, tradeType: unknown, futureExpiry: string | null = null): ParsedScrip | null {
  /**
   * Only the three indices have futures the journal handles - MCX futures aren't modelled anywhere else (Risk, charges,
   * lot sizes), so a commodity future reads as an untracked underlying and is listed as left out, not imported mis-billed.
   */
  const futureInstrument = (name: string): Instrument | null => {
    const instrument = INSTRUMENT_BY_REPORT_NAME[name.toUpperCase()];
    return instrument && !isCommodityInstrument(instrument) ? instrument : null;
  };
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
    return { name, instrument: futureInstrument(name), expiry, optionType: null, strike: null };
  }
  const bare = tradeType === "FUT" ? BARE_FUTURE_SCRIP.exec(scrip.trim()) : null;
  if (bare) {
    const name = bare[1];
    return { name, instrument: futureInstrument(name), expiry: futureExpiry, optionType: null, strike: null };
  }
  return null;
}

/**
 * A report row for a journalled index future that doesn't name its expiry month - the expiry has to come from
 * somewhere else. A stock or commodity future is not one: it is left out of the journal, so nothing needs looking up.
 */
export function isUndatedFutureRow(row: Record<string, unknown>): boolean {
  if (row.trade_type !== "FUT" || typeof row.scrip_name !== "string" || FUTURE_SCRIP.test(row.scrip_name.trim())) return false;
  return parseScrip(row.scrip_name, "FUT")?.instrument != null;
}

/**
 * Every date (yyyy-mm-dd) the trade history is needed for, so one call per segment covers both uses of it: the buy and
 * sell dates of the undated futures (their expiry is only in the fills), and the day of every same-day round trip (which leg
 * came first is only in the fills). Rows the journal leaves out need neither.
 */
export function datesNeedingFills(rows: Record<string, unknown>[]): string[] {
  const dates: string[] = [];
  for (const row of rows) {
    const buyDate = reportDate(row.buy_date);
    const sellDate = reportDate(row.sell_date);
    if (!buyDate || !sellDate) continue;
    const parsed = typeof row.scrip_name === "string" ? parseScrip(row.scrip_name, row.trade_type) : null;
    if (!parsed?.instrument) continue;
    if (isUndatedFutureRow(row)) dates.push(buyDate, sellDate);
    else if (buyDate === sellDate) dates.push(buyDate);
  }
  return dates.sort();
}

/**
 * The expiry of an undated future row, read off the trade history: the contract that was bought on the
 * row's buy date and sold on its sell date. Bought-and-sold is what tells two contracts apart on a day
 * the trader rolled from one month to the next. Null when the history doesn't settle on exactly one.
 */
function futureExpiryFromFills(row: Record<string, unknown>, fills: HistoricalFill[]): string | null {
  const name = String(row.scrip_name).trim().replace(/\s+FUT$/i, "").toUpperCase();
  const buyDate = reportDate(row.buy_date);
  const sellDate = reportDate(row.sell_date);
  if (!buyDate || !sellDate) return null;

  // A future's fill has no option type (and a strike of 0).
  const futureFills = fills.filter((f) => f.symbol.toUpperCase() === name && f.optionType === "" && f.expiry !== "");
  const expiriesOf = (side: "BUY" | "SELL", date: string) => new Set(futureFills.filter((f) => f.side === side && f.date === date).map((f) => f.expiry));
  const bought = expiriesOf("BUY", buyDate);
  const sold = expiriesOf("SELL", sellDate);

  const both = [...bought].filter((expiry) => sold.has(expiry));
  const candidates = both.length > 0 ? both : [...new Set([...bought, ...sold])];
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) return null;

  // Still several: the one whose buy fill is at the row's buy price.
  const buyPrice = round2(num(row.buy_average));
  const atPrice = candidates.filter((expiry) =>
    futureFills.some((f) => f.expiry === expiry && f.side === "BUY" && f.date === buyDate && round2(f.price) === buyPrice),
  );
  return atPrice.length === 1 ? atPrice[0] : null;
}

/**
 * The rows with each undated future's expiry attached (as `contract_expiry`), where the trade history
 * could tell. Other rows - and futures it couldn't place - come back untouched.
 */
export function withFutureExpiries(rows: Record<string, unknown>[], fills: HistoricalFill[]): Record<string, unknown>[] {
  return rows.map((row) => {
    if (!isUndatedFutureRow(row)) return row;
    const expiry = futureExpiryFromFills(row, fills);
    return expiry ? { ...row, contract_expiry: expiry } : row;
  });
}

/** "30-10-2026" → "2026-10-30". */
export function reportDate(value: unknown): string | null {
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
    const parsed =
      typeof row.scrip_name === "string"
        ? parseScrip(row.scrip_name, row.trade_type, typeof row.contract_expiry === "string" ? row.contract_expiry : null)
        : null;
    const buyDate = reportDate(row.buy_date);
    const sellDate = reportDate(row.sell_date);
    const rowQuantity = num(row.quantity);
    if (!parsed?.instrument || !buyDate || !sellDate || !(rowQuantity > 0)) {
      otherCount++;
      otherNames.add(parsed?.name ?? (typeof row.scrip_name === "string" ? row.scrip_name : "Unknown"));
      continue;
    }
    const key = [parsed.instrument, parsed.expiry ?? "", parsed.strike ?? "FUT", parsed.optionType ?? "", buyDate, sellDate].join("|");
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
        (group.expiry === null || f.expiry === group.expiry) &&
        // A future matches only future fills - not the same index's options, which share its symbol.
        (group.optionType === null ? f.optionType === "" : f.optionType === group.optionType && f.strike === group.strike),
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
