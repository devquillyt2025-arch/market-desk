/**
 * Pure aggregation for the Reports tab. No React, no Supabase — takes the
 * same TradeEntry[] the Trade Entries table already fetches and reduces it
 * into the shapes each chart/stat needs.
 */

import { calculateBrokerage, type BrokerageSegment } from "@/lib/calculateBrokerage";
import { round2 } from "@/lib/calculateTrade";
import { describeEntryContract } from "@/lib/tradeEntriesStore";
import {
  DEFAULT_LOT_SIZES,
  INSTRUMENT_LABELS,
  INSTRUMENTS,
  type Instrument,
  type Payment,
  type TradeEntry,
  type TradeEntryOptionType,
  type TradeEntrySide,
} from "@/lib/types";

/**
 * All three tracked instruments (NIFTY/BANKNIFTY/SENSEX) are index
 * derivatives — an entry is Options when it carries a strike/option type,
 * otherwise it's an index Futures trade. Neither Delivery nor Intraday
 * (equity-only segments) applies here.
 */
function entryBrokerageSegment(entry: TradeEntry): BrokerageSegment {
  return entry.option_type ? "OPTIONS" : "FUTURES";
}

/** Estimated round-trip charges (brokerage, STT, GST, etc.) for one entry — see calculateBrokerage.ts. */
function entryCharges(entry: TradeEntry): number {
  const qty = DEFAULT_LOT_SIZES[entry.instrument] * entry.lots;
  const { totalCharges } = calculateBrokerage(
    entryBrokerageSegment(entry),
    [{ buyPrice: entry.buy_price, sellPrice: entry.sell_price }],
    qty,
  );
  return totalCharges;
}

export const DATE_RANGES = ["7d", "30d", "90d", "all", "custom"] as const;
export type DateRange = (typeof DATE_RANGES)[number];

export const DATE_RANGE_LABELS: Record<DateRange, string> = {
  "7d": "7D",
  "30d": "30D",
  "90d": "90D",
  all: "All",
  custom: "Custom",
};

export type CustomRange = { from: string; to: string };

/**
 * `custom` only applies when `range === "custom"` — an unset from/to on that
 * side is treated as "no lower/upper bound" rather than excluding everything.
 */
export function filterEntriesByRange(entries: TradeEntry[], range: DateRange, custom?: CustomRange): TradeEntry[] {
  if (range === "all") return entries;
  if (range === "custom") {
    const from = custom?.from?.trim();
    const to = custom?.to?.trim();
    if (!from && !to) return entries;
    return entries.filter((e) => (!from || e.entry_date >= from) && (!to || e.entry_date <= to));
  }
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  return entries.filter((e) => e.entry_date >= cutoffIso);
}

export type TradeHighlight = {
  id: string;
  label: string;
  date: string;
  pnl: number;
};

export type StreakInfo = {
  type: "win" | "loss" | "none";
  count: number;
};

export type ReportSummary = {
  totalPnl: number;
  /** Estimated brokerage/STT/GST/etc. summed across all entries — see calculateBrokerage.ts. */
  totalCharges: number;
  /** totalPnl minus totalCharges. */
  netPnl: number;
  totalTrades: number;
  winCount: number;
  lossCount: number;
  winRatePct: number;
  avgPnl: number;
  squaredOffCount: number;
  holdCount: number;
  bestTrade: TradeHighlight | null;
  worstTrade: TradeHighlight | null;
  /** Largest peak-to-trough decline in the cumulative P&L curve, as a non-negative number. */
  maxDrawdown: number;
  currentStreak: StreakInfo;
  /** Gross profit / |gross loss|. Null when there are no losing trades to divide by (no ceiling to report). */
  profitFactor: number | null;
  avgWin: number;
  /** Negative (or zero) — the average of losing trades' own (negative) P&L. */
  avgLoss: number;
};

function sortByDate(entries: TradeEntry[]): TradeEntry[] {
  return [...entries].sort((a, b) => {
    if (a.entry_date !== b.entry_date) return a.entry_date < b.entry_date ? -1 : 1;
    return a.created_at < b.created_at ? -1 : 1;
  });
}

function toHighlight(entry: TradeEntry): TradeHighlight {
  return { id: entry.id, label: describeEntryContract(entry), date: entry.entry_date, pnl: entry.pnl };
}

function computeMaxDrawdown(sortedEntries: TradeEntry[]): number {
  let running = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const entry of sortedEntries) {
    running = round2(running + entry.pnl);
    if (running > peak) peak = running;
    const drawdown = round2(peak - running);
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }
  return maxDrawdown;
}

/** Consecutive same-direction trades ending at the most recent one — a flat (0 P&L) trade breaks the streak. */
function computeCurrentStreak(sortedEntries: TradeEntry[]): StreakInfo {
  let type: "win" | "loss" | null = null;
  let count = 0;
  for (let i = sortedEntries.length - 1; i >= 0; i--) {
    const pnl = sortedEntries[i].pnl;
    const outcome = pnl > 0 ? "win" : pnl < 0 ? "loss" : null;
    if (outcome === null) break;
    if (type === null) type = outcome;
    if (outcome !== type) break;
    count++;
  }
  return type ? { type, count } : { type: "none", count: 0 };
}

export function summarizeEntries(entries: TradeEntry[]): ReportSummary {
  const totalTrades = entries.length;
  const totalPnl = round2(entries.reduce((sum, e) => sum + e.pnl, 0));
  const totalCharges = round2(entries.reduce((sum, e) => sum + entryCharges(e), 0));
  const netPnl = round2(totalPnl - totalCharges);
  const wins = entries.filter((e) => e.pnl > 0);
  const losses = entries.filter((e) => e.pnl < 0);
  const winCount = wins.length;
  const lossCount = losses.length;
  const squaredOffCount = entries.filter((e) => e.status === "squared_off").length;

  const grossProfit = round2(wins.reduce((sum, e) => sum + e.pnl, 0));
  const grossLoss = round2(losses.reduce((sum, e) => sum + e.pnl, 0));

  const sorted = sortByDate(entries);
  const best = sorted.reduce<TradeEntry | null>((acc, e) => (acc === null || e.pnl > acc.pnl ? e : acc), null);
  const worst = sorted.reduce<TradeEntry | null>((acc, e) => (acc === null || e.pnl < acc.pnl ? e : acc), null);

  return {
    totalPnl,
    totalCharges,
    netPnl,
    totalTrades,
    winCount,
    lossCount,
    winRatePct: totalTrades > 0 ? round2((winCount / totalTrades) * 100) : 0,
    avgPnl: totalTrades > 0 ? round2(totalPnl / totalTrades) : 0,
    squaredOffCount,
    holdCount: totalTrades - squaredOffCount,
    bestTrade: best && best.pnl !== 0 ? toHighlight(best) : null,
    worstTrade: worst && worst.pnl !== 0 ? toHighlight(worst) : null,
    maxDrawdown: computeMaxDrawdown(sorted),
    currentStreak: computeCurrentStreak(sorted),
    profitFactor: grossLoss < 0 ? round2(grossProfit / Math.abs(grossLoss)) : null,
    avgWin: winCount > 0 ? round2(grossProfit / winCount) : 0,
    avgLoss: lossCount > 0 ? round2(grossLoss / lossCount) : 0,
  };
}

export type CumulativePoint = {
  date: string;
  cumulativePnl: number;
};

/** Running total in chronological order — the account's growth curve over the filtered range. */
export function computeCumulativeSeries(entries: TradeEntry[]): CumulativePoint[] {
  let running = 0;
  return sortByDate(entries).map((entry) => {
    running = round2(running + entry.pnl);
    return { date: entry.entry_date, cumulativePnl: running };
  });
}

export type AccountGrowthPoint = {
  date: string;
  /** Net cash actually put into the account so far — Payment tab's Pay Ins minus Payouts, running total. */
  capital: number;
  /** capital + cumulative trade P&L up to this date — the account's real value, not just what was deposited. */
  equity: number;
};

/**
 * How the account has grown from funding + trading, not filtered by the
 * page's own date-range selector (like the calendar heatmap below) — a
 * "since 30D ago" view would otherwise start from whatever the balance
 * happened to be at the edge of that window instead of the real starting
 * capital, which would misrepresent growth rather than show it.
 *
 * Trade P&L lands on its closing_date, same as the calendar heatmap — the
 * account's equity only actually moves once a position is realized, not
 * the day it was opened. An entry with no closing_date yet (still "hold")
 * contributes nothing here until it's squared off.
 */
export function computeAccountGrowthSeries(entries: TradeEntry[], payments: Payment[]): AccountGrowthPoint[] {
  type Event = { date: string; seq: number; capitalDelta: number; pnlDelta: number };
  const events: Event[] = [];
  let seq = 0;
  for (const p of payments) {
    // Only money that has actually moved counts toward capital — a
    // "pending"/"partial" payin or payout hasn't landed yet, per Payment's
    // own `status` semantics (see its doc comment in types.ts).
    if (p.status !== "paid") continue;
    events.push({
      date: p.entry_date,
      seq: seq++,
      capitalDelta: p.type === "payin" ? p.payout_amount : -p.payout_amount,
      pnlDelta: 0,
    });
  }
  for (const e of entries) {
    if (!e.closing_date) continue;
    events.push({ date: e.closing_date, seq: seq++, capitalDelta: 0, pnlDelta: e.pnl });
  }
  // Stable chronological order — `seq` (insertion order, payments before
  // that day's entries) only breaks ties between a payment and a trade
  // landing on the exact same date, so the line moves in a fixed order
  // rather than jittering between renders.
  events.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.seq - b.seq));

  let capital = 0;
  let pnl = 0;
  return events.map((ev) => {
    capital = round2(capital + ev.capitalDelta);
    pnl = round2(pnl + ev.pnlDelta);
    return { date: ev.date, capital, equity: round2(capital + pnl) };
  });
}

export type CategoryPnl = {
  label: string;
  pnl: number;
};

export function computePnlByInstrument(entries: TradeEntry[]): CategoryPnl[] {
  const totals = new Map<Instrument, number>();
  for (const entry of entries) {
    totals.set(entry.instrument, round2((totals.get(entry.instrument) ?? 0) + entry.pnl));
  }
  return INSTRUMENTS.filter((i) => totals.has(i)).map((i) => ({
    label: INSTRUMENT_LABELS[i],
    pnl: totals.get(i) ?? 0,
  }));
}

const SIDE_ORDER: TradeEntrySide[] = ["buy", "sell"];
const SIDE_LABELS: Record<TradeEntrySide, string> = { buy: "Buy", sell: "Sell" };

export function computePnlBySide(entries: TradeEntry[]): CategoryPnl[] {
  const totals = new Map<TradeEntrySide, number>();
  for (const entry of entries) {
    totals.set(entry.side, round2((totals.get(entry.side) ?? 0) + entry.pnl));
  }
  return SIDE_ORDER.filter((s) => totals.has(s)).map((s) => ({ label: SIDE_LABELS[s], pnl: totals.get(s) ?? 0 }));
}

const OPTION_TYPE_ORDER: TradeEntryOptionType[] = ["CE", "PE"];

/** Only entries with an option_type set — plain futures/non-options entries don't contribute here. */
export function computePnlByOptionType(entries: TradeEntry[]): CategoryPnl[] {
  const totals = new Map<TradeEntryOptionType, number>();
  for (const entry of entries) {
    if (!entry.option_type) continue;
    totals.set(entry.option_type, round2((totals.get(entry.option_type) ?? 0) + entry.pnl));
  }
  return OPTION_TYPE_ORDER.filter((t) => totals.has(t)).map((t) => ({ label: t, pnl: totals.get(t) ?? 0 }));
}

function formatMonthLabel(yyyyMm: string): string {
  const [y, m] = yyyyMm.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
}

/** One bar per calendar month present in `entries`, oldest to newest. */
export function computePnlByMonth(entries: TradeEntry[]): CategoryPnl[] {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    const key = entry.entry_date.slice(0, 7);
    totals.set(key, round2((totals.get(key) ?? 0) + entry.pnl));
  }
  return [...totals.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, pnl]) => ({
    label: formatMonthLabel(key),
    pnl,
  }));
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Monday-first, matching how the rest of the app orders the week. */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function computePnlByDayOfWeek(entries: TradeEntry[]): CategoryPnl[] {
  const totals = new Map<number, number>();
  for (const entry of entries) {
    const day = new Date(`${entry.entry_date}T00:00:00`).getDay();
    totals.set(day, round2((totals.get(day) ?? 0) + entry.pnl));
  }
  return DAY_ORDER.filter((d) => totals.has(d)).map((d) => ({
    label: DAY_LABELS[d],
    pnl: totals.get(d) ?? 0,
  }));
}

export type TradeMixSlice = {
  label: string;
  count: number;
};

/**
 * How many trades landed in each instrument, over the filtered range — where
 * the account's trading *activity* concentrates, independent of whether it
 * made or lost money there. A different lens than the P&L breakdowns above,
 * which are all about profit, not volume.
 */
export function computeTradeMixByInstrument(entries: TradeEntry[]): TradeMixSlice[] {
  const counts = new Map<Instrument, number>();
  for (const entry of entries) {
    counts.set(entry.instrument, (counts.get(entry.instrument) ?? 0) + 1);
  }
  return INSTRUMENTS.filter((i) => counts.has(i)).map((i) => ({
    label: INSTRUMENT_LABELS[i],
    count: counts.get(i) ?? 0,
  }));
}

/**
 * date (yyyy-mm-dd) -> total P&L that day — the calendar heatmap's data
 * source, always over the full history. Keyed by closing_date (when the
 * position was actually squared off), not entry_date (when it was opened)
 * — a trade's P&L belongs to the day it was realized, not the day it was
 * placed. Entries with no closing_date yet (still "hold", or logged before
 * that field existed) have no day to attribute P&L to, so they're skipped
 * here rather than falling back to entry_date.
 */
export function computeDailyPnlMap(entries: TradeEntry[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.closing_date) continue;
    totals.set(entry.closing_date, round2((totals.get(entry.closing_date) ?? 0) + entry.pnl));
  }
  return totals;
}

const CSV_COLUMNS = [
  "Date",
  "Closing Date",
  "Instrument",
  "Strike",
  "Type",
  "Side",
  "Lots",
  "Buy Price",
  "Sell Price",
  "P&L",
  "Status",
  "Remarks",
] as const;

function csvField(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Row order matches CSV_COLUMNS. Escapes commas/quotes/newlines per RFC 4180. */
export function buildReportCsv(entries: TradeEntry[]): string {
  const rows = sortByDate(entries).map((e) =>
    [
      e.entry_date,
      e.closing_date ?? "",
      e.instrument,
      e.strike_price ?? "",
      e.option_type ?? "",
      SIDE_LABELS[e.side],
      e.lots,
      e.buy_price,
      e.sell_price,
      e.pnl,
      e.status,
      e.remarks ?? "",
    ].map(csvField),
  );
  return [CSV_COLUMNS.map(csvField), ...rows].map((row) => row.join(",")).join("\r\n");
}
