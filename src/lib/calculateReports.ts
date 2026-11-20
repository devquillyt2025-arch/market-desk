/**
 * Pure aggregation for the Reports tab. No React, no Supabase — takes a list
 * of trades and reduces it into the shapes each chart/stat needs. Reports reads
 * Upstox's own P&L report (see ReportTrade); the Trade Entries journal's
 * TradeEntry[] has the same shape and goes through the same maths.
 */

import { calculateBrokerage, optionsSegmentFor, type BrokerageSegment } from "@/lib/calculateBrokerage";
import { round2 } from "@/lib/calculateTrade";
import { localIsoDate } from "@/lib/localDate";
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
  type TradeEntryStatus,
} from "@/lib/types";
import type { UpstoxReportTrade } from "@/lib/upstox/types";

/**
 * What the report maths reads from a trade. A journal entry (TradeEntry) fits it, and so does a row of Upstox's P&L
 * report read as a trade (UpstoxReportTrade) - so Reports can follow Upstox while the journal page keeps its own figures.
 * `instrument` is the underlying's name, not necessarily one the journal tracks (FINNIFTY, a stock); `label` names the
 * contract where `instrument` isn't enough; `side` is null for a trade opened and closed the same day, whose order the
 * Upstox report doesn't give.
 */
export type ReportTrade = {
  id: string;
  entry_date: string;
  closing_date: string | null;
  instrument: string;
  strike_price: number | null;
  option_type: TradeEntryOptionType | null;
  side: TradeEntrySide | null;
  pnl: number;
  status: TradeEntryStatus;
  created_at: string;
  label?: string;
};

/**
 * The tracked instruments (the NIFTY/BANKNIFTY/SENSEX indices, and MCX
 * crude oil and gold) are all derivatives — an entry is Options when it
 * carries a strike/option type, otherwise it's a Futures trade (billed at the
 * index futures rates, even for a commodity - commodity futures aren't
 * modelled). Neither Delivery nor Intraday (equity-only segments) applies here.
 */
function entryBrokerageSegment(entry: TradeEntry): BrokerageSegment {
  return entry.option_type ? optionsSegmentFor(entry.instrument) : "FUTURES";
}

/** The day the entry's sell order went in - the entry day for a short, the closing day for a long - which is when STT was charged. */
function sellDate(entry: TradeEntry): string {
  return entry.side === "sell" ? entry.entry_date : (entry.closing_date ?? entry.entry_date);
}

/** Estimated round-trip charges (brokerage, STT, GST, etc.) for one entry — see calculateBrokerage.ts. */
function entryCharges(entry: TradeEntry): number {
  const qty = DEFAULT_LOT_SIZES[entry.instrument] * entry.lots;
  const { totalCharges } = calculateBrokerage(
    entryBrokerageSegment(entry),
    [{ buyPrice: entry.buy_price, sellPrice: entry.sell_price }],
    qty,
    sellDate(entry),
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

const PRESET_DAYS = { "7d": 7, "30d": 30, "90d": 90 } as const;

/**
 * The first and last day (yyyy-mm-dd, inclusive) a range covers; null on a
 * side with no bound. `custom` only applies when `range === "custom"` — an unset
 * from/to on that side is treated as "no lower/upper bound" rather than excluding
 * everything. The one definition of a range, shared by every section of Reports
 * and by the charges asked of Upstox, so a click on the time frame moves them all alike.
 */
export function rangeBounds(range: DateRange, custom?: CustomRange, now: Date = new Date()): { from: string | null; to: string | null } {
  if (range === "all") return { from: null, to: null };
  if (range === "custom") return { from: custom?.from?.trim() || null, to: custom?.to?.trim() || null };
  return { from: localIsoDate(PRESET_DAYS[range], now), to: null };
}

/**
 * The day a trade counts for: the day it was squared off - when its P&L became
 * real, and the day Upstox files it under. A position with no closing date yet
 * (still "hold") has only the day it was opened.
 */
export function tradeDay(entry: Pick<ReportTrade, "entry_date" | "closing_date">): string {
  return entry.closing_date ?? entry.entry_date;
}

/**
 * Trades whose trade day (see tradeDay) falls in the range. By closing date,
 * not opening date: a position opened on the 12th and closed on the 27th belongs
 * to a "last 30 days" window that starts on the 21st, as it does in Upstox's own
 * report, the Cumulative P&L chart and the calendar.
 */
export function filterEntriesByRange<T extends ReportTrade>(entries: T[], range: DateRange, custom?: CustomRange, now: Date = new Date()): T[] {
  const { from, to } = rangeBounds(range, custom, now);
  if (!from && !to) return entries;
  return entries.filter((e) => {
    const day = tradeDay(e);
    return (!from || day >= from) && (!to || day <= to);
  });
}

/**
 * The dates Upstox is asked for (its charges) for a range - the same window the trades are cut to, up to today at the
 * latest. With no start of its own ("All", an open custom start) it begins at the financial year two before this
 * one: as far back as the P&L report is read (see /api/upstox/pnl-trades).
 */
export function reportWindow(range: DateRange, custom: CustomRange | undefined, now: Date = new Date()): { from: string; to: string } {
  const today = localIsoDate(0, now);
  const bounds = rangeBounds(range, custom, now);
  const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return { from: bounds.from ?? `${fyStart - 2}-04-01`, to: bounds.to && bounds.to < today ? bounds.to : today };
}

export const CUMULATIVE_RANGES = ["7d", "15d", "30d", "90d", "all"] as const;
export type CumulativeRange = (typeof CUMULATIVE_RANGES)[number];

export const CUMULATIVE_RANGE_LABELS: Record<CumulativeRange, string> = {
  "7d": "1W",
  "15d": "15D",
  "30d": "1M",
  "90d": "3M",
  all: "All",
};

/**
 * Own range control for the Cumulative P&L chart, independent of the page's
 * main date-range filter — filters by closing_date (what the chart actually
 * plots) rather than entry_date, so "1W" means "closed in the last 7 days".
 */
export function filterEntriesByClosingRange<T extends ReportTrade>(entries: T[], range: CumulativeRange, now: Date = new Date()): T[] {
  if (range === "all") return entries;
  const days = range === "7d" ? 7 : range === "15d" ? 15 : range === "30d" ? 30 : 90;
  const cutoffIso = localIsoDate(days, now);
  return entries.filter((e) => e.closing_date && e.closing_date >= cutoffIso);
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
  /** Brokerage/STT/GST/etc.: Upstox's own figure where it was given (summarizeTrades), otherwise estimated per entry — see calculateBrokerage.ts. */
  totalCharges: number;
  /** totalPnl minus totalCharges. */
  netPnl: number;
  /** Sum of the winning trades' P&L. */
  grossProfit: number;
  /** Sum of the losing trades' P&L - negative or zero. */
  grossLoss: number;
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

/** In the order P&L was realised: by trade day (the closing date), then as created. Streaks and drawdown follow this. */
function sortByDate<T extends ReportTrade>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    const aDay = tradeDay(a);
    const bDay = tradeDay(b);
    if (aDay !== bDay) return aDay < bDay ? -1 : 1;
    return a.created_at < b.created_at ? -1 : 1;
  });
}

/** What a trade is called: its own label (an Upstox row names its contract), else the journal's description of it. */
function tradeLabel(entry: ReportTrade): string {
  // A journal entry's `instrument` is always one of ours - only a trade carrying a label can be anything else.
  return entry.label ?? describeEntryContract({ ...entry, instrument: entry.instrument as Instrument });
}

function toHighlight(entry: ReportTrade): TradeHighlight {
  return { id: entry.id, label: tradeLabel(entry), date: tradeDay(entry), pnl: entry.pnl };
}

function computeMaxDrawdown(sortedEntries: ReportTrade[]): number {
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
function computeCurrentStreak(sortedEntries: ReportTrade[]): StreakInfo {
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

/** The journal page's summary, with charges estimated entry by entry (see entryCharges). */
export function summarizeEntries(entries: TradeEntry[]): ReportSummary {
  return summarizeTrades(entries, round2(entries.reduce((sum, e) => sum + entryCharges(e), 0)));
}

/**
 * Reports' summary. `totalCharges` is what the trades cost to place - Upstox's own figure for the same window, since a
 * report row carries no charges of its own.
 */
export function summarizeTrades<T extends ReportTrade>(entries: T[], totalCharges: number): ReportSummary {
  const totalTrades = entries.length;
  const totalPnl = round2(entries.reduce((sum, e) => sum + e.pnl, 0));
  const netPnl = round2(totalPnl - totalCharges);
  const wins = entries.filter((e) => e.pnl > 0);
  const losses = entries.filter((e) => e.pnl < 0);
  const winCount = wins.length;
  const lossCount = losses.length;
  const squaredOffCount = entries.filter((e) => e.status === "squared_off").length;

  const grossProfit = round2(wins.reduce((sum, e) => sum + e.pnl, 0));
  const grossLoss = round2(losses.reduce((sum, e) => sum + e.pnl, 0));

  const sorted = sortByDate(entries);
  const best = sorted.reduce<T | null>((acc, e) => (acc === null || e.pnl > acc.pnl ? e : acc), null);
  const worst = sorted.reduce<T | null>((acc, e) => (acc === null || e.pnl < acc.pnl ? e : acc), null);

  return {
    totalPnl,
    totalCharges,
    netPnl,
    grossProfit,
    grossLoss,
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

/**
 * Running total in chronological order — the account's growth curve over the
 * filtered range. P&L lands on its closing_date, same as computeAccountGrowthSeries
 * and the calendar heatmap: it only actually realizes once a position is squared
 * off, not the day it was opened. An entry with no closing_date yet ("hold")
 * contributes nothing here until it closes.
 */
export function computeCumulativeSeries(entries: ReportTrade[]): CumulativePoint[] {
  const closed = entries.filter((e) => e.closing_date);
  const sorted = [...closed].sort((a, b) => {
    const aDate = a.closing_date as string;
    const bDate = b.closing_date as string;
    if (aDate !== bDate) return aDate < bDate ? -1 : 1;
    return a.created_at < b.created_at ? -1 : 1;
  });
  // One point per calendar day — several trades closing the same day collapse
  // into a single running total as of end of day, so the x-axis shows each
  // date once instead of repeating it per trade.
  const points: CumulativePoint[] = [];
  let running = 0;
  for (const entry of sorted) {
    running = round2(running + entry.pnl);
    const date = entry.closing_date as string;
    const last = points[points.length - 1];
    if (last && last.date === date) {
      last.cumulativePnl = running;
    } else {
      points.push({ date, cumulativePnl: running });
    }
  }
  return points;
}

/**
 * P&L relative to invested capital, as a signed percentage — the "return %"
 * metric alongside the ₹ P&L stat tiles. Null when there's no capital to
 * divide by yet (no Pay In logged on the Payment tab), rather than showing a
 * misleading 0% or an infinite return.
 */
export function computeReturnPct(pnl: number, capital: number): number | null {
  return capital > 0 ? round2((pnl / capital) * 100) : null;
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
export function computeAccountGrowthSeries(entries: ReportTrade[], payments: Payment[]): AccountGrowthPoint[] {
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
  /**
   * Share of this breakdown's own total P&L, as a signed percentage —
   * pnl / sum(all pnl in this breakdown) * 100. Since the denominator is the
   * sum of every slice, the slices always add up to exactly 100% (e.g. a
   * losing month can show as a negative % that eats into a winning one's
   * >100%), which is the correct decomposition of the net result rather than
   * a share of trading volume. 0 when the breakdown nets to exactly zero.
   */
  pct: number;
};

/** Attaches `pct` (each pnl's signed share of the group's own total) to a set of category totals. */
function withPct(items: { label: string; pnl: number }[]): CategoryPnl[] {
  const total = items.reduce((sum, item) => sum + item.pnl, 0);
  return items.map((item) => ({ ...item, pct: total !== 0 ? round2((item.pnl / total) * 100) : 0 }));
}

/** One bar per underlying: the ones the journal tracks first, in their usual order, then any other (FINNIFTY, a stock) by name. */
export function computePnlByInstrument(entries: ReportTrade[]): CategoryPnl[] {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    totals.set(entry.instrument, round2((totals.get(entry.instrument) ?? 0) + entry.pnl));
  }
  const tracked: readonly string[] = INSTRUMENTS;
  const names = [...INSTRUMENTS.filter((i) => totals.has(i)), ...[...totals.keys()].filter((name) => !tracked.includes(name)).sort((a, b) => a.localeCompare(b))];
  return withPct(names.map((name) => ({ label: INSTRUMENT_LABELS[name as Instrument] ?? name, pnl: totals.get(name) ?? 0 })));
}

type SideKey = TradeEntrySide | "same-day";
const SIDE_ORDER: SideKey[] = ["buy", "sell", "same-day"];
/** "Same day": bought and sold within one day - Upstox's report doesn't say which came first, so it can't be called a buy or a sell. */
const SIDE_LABELS: Record<SideKey, string> = { buy: "Buy", sell: "Sell", "same-day": "Same day" };

export function computePnlBySide(entries: ReportTrade[]): CategoryPnl[] {
  const totals = new Map<SideKey, number>();
  for (const entry of entries) {
    const side = entry.side ?? "same-day";
    totals.set(side, round2((totals.get(side) ?? 0) + entry.pnl));
  }
  return withPct(SIDE_ORDER.filter((s) => totals.has(s)).map((s) => ({ label: SIDE_LABELS[s], pnl: totals.get(s) ?? 0 })));
}

const OPTION_TYPE_ORDER: TradeEntryOptionType[] = ["CE", "PE"];

/** Only entries with an option_type set — plain futures/non-options entries don't contribute here. */
export function computePnlByOptionType(entries: ReportTrade[]): CategoryPnl[] {
  const totals = new Map<TradeEntryOptionType, number>();
  for (const entry of entries) {
    if (!entry.option_type) continue;
    totals.set(entry.option_type, round2((totals.get(entry.option_type) ?? 0) + entry.pnl));
  }
  return withPct(OPTION_TYPE_ORDER.filter((t) => totals.has(t)).map((t) => ({ label: t, pnl: totals.get(t) ?? 0 })));
}

function formatMonthLabel(yyyyMm: string): string {
  const [y, m] = yyyyMm.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
}

/** One bar per calendar month present in `entries`, oldest to newest - the month each trade closed in, when its P&L was realised. */
export function computePnlByMonth(entries: ReportTrade[]): CategoryPnl[] {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    const key = tradeDay(entry).slice(0, 7);
    totals.set(key, round2((totals.get(key) ?? 0) + entry.pnl));
  }
  return withPct(
    [...totals.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, pnl]) => ({
      label: formatMonthLabel(key),
      pnl,
    })),
  );
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Monday-first, matching how the rest of the app orders the week. */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** P&L by the weekday each trade closed on - the day it was realised. */
export function computePnlByDayOfWeek(entries: ReportTrade[]): CategoryPnl[] {
  const totals = new Map<number, number>();
  for (const entry of entries) {
    const day = new Date(`${tradeDay(entry)}T00:00:00`).getDay();
    totals.set(day, round2((totals.get(day) ?? 0) + entry.pnl));
  }
  return withPct(
    DAY_ORDER.filter((d) => totals.has(d)).map((d) => ({
      label: DAY_LABELS[d],
      pnl: totals.get(d) ?? 0,
    })),
  );
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
export function computeDailyPnlMap(entries: ReportTrade[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.closing_date) continue;
    totals.set(entry.closing_date, round2((totals.get(entry.closing_date) ?? 0) + entry.pnl));
  }
  return totals;
}

const CSV_COLUMNS = [
  "Closed",
  "Opened",
  "Segment",
  "Underlying",
  "Contract",
  "Strike",
  "Type",
  "Expiry",
  "Side",
  "Quantity",
  "Buy Avg",
  "Sell Avg",
  "Buy Value",
  "Sell Value",
  "P&L",
] as const;

function csvField(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Upstox's own report rows as a CSV, oldest close first - one line per row, as the report lists them. Row order matches
 * CSV_COLUMNS; commas, quotes and newlines are escaped per RFC 4180. Quantity is as Upstox counts it: units, or lots on MCX.
 */
export function buildReportCsv(trades: UpstoxReportTrade[]): string {
  const rows = sortByDate(trades).map((t) =>
    [
      t.closing_date,
      t.entry_date,
      t.segment,
      t.instrument,
      t.label,
      t.strike_price ?? "",
      t.option_type ?? "",
      t.expiry_date ?? "",
      t.side ? SIDE_LABELS[t.side] : SIDE_LABELS["same-day"],
      t.quantity,
      t.buy_price,
      t.sell_price,
      t.buy_amount,
      t.sell_amount,
      t.pnl,
    ].map(csvField),
  );
  return [CSV_COLUMNS.map(csvField), ...rows].map((row) => row.join(",")).join("\r\n");
}
