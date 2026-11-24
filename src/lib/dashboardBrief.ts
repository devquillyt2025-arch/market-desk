/**
 * The figures behind the Dashboard - no React and no fetching. The Dashboard is one quick look at every tab: what is happening
 * (prices, positions), what has happened (the last 30 days, the account) and what is about to happen (sessions, expiries, the
 * open). Each figure reuses what its own page computes (the board's ordering, the Live Portfolio's live P&L, Reports' summary,
 * the Payment ledger's capital), so a number here is the same number there.
 */

import type { PortfolioRow } from "@/lib/calculatePortfolio";
import { computeAccountGrowthSeries, computeDailyPnlMap, computeReturnPct, filterEntriesByRange, reportWindow, summarizeTrades, type ReportSummary, type ReportTrade } from "@/lib/calculateReports";
import { addDays, daysBetween, expiryCloseMs, istDateString } from "@/lib/calculateStrategy";
import { byMoveDescending, type BoardEntry } from "@/lib/commodityBoard";
import { describeEntryContract } from "@/lib/tradeEntriesStore";
import { DEFAULT_LOT_SIZES, mcxSessionCloseIst, usSummerTime, type PaperTradeEntry, type Payment, type TradeEntry } from "@/lib/types";
import { segmentsOfScope, type HeatmapQuote, type UpstoxReportTrade } from "@/lib/upstox/types";
import { moveDirection } from "@/lib/watchlist";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const IST_OFFSET_MS = 5.5 * 3_600_000;

/** "28 Dec" from a yyyy-mm-dd date ("" for anything else). */
export function dayLabel(iso: string): string {
  const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(iso);
  const month = match ? MONTHS[Number(match[1]) - 1] : undefined;
  return match && month ? `${Number(match[2])} ${month}` : "";
}

// --- Sessions ---------------------------------------------------------------------------

export type SessionId = "NSE" | "MCX" | "NYSE";

export type Session = {
  id: SessionId;
  /** Trading now. */
  open: boolean;
  /** When the session next changes: its close while it is open, its next open while it is shut (ms since epoch). */
  at: number;
  /** That moment as a clock time in India ("15:30"). */
  clock: string;
};

type Window = { open: number; close: number };

function isWeekday(iso: string): boolean {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return day >= 1 && day <= 5;
}

/** Each market's trading window on a date of its own calendar, or null on a day it doesn't trade. Exchange holidays aren't known here, so a holiday reads as a normal day. */
const WINDOWS: Record<SessionId, (iso: string) => Window | null> = {
  NSE: (iso) => (isWeekday(iso) ? { open: Date.parse(`${iso}T09:15:00+05:30`), close: Date.parse(`${iso}T15:30:00+05:30`) } : null),
  MCX: (iso) => (isWeekday(iso) ? { open: Date.parse(`${iso}T09:00:00+05:30`), close: Date.parse(`${iso}T${mcxSessionCloseIst(iso)}:00+05:30`) } : null),
  // 9:30 to 16:00 in New York, which is four hours behind UTC in US summer time and five outside it.
  NYSE: (iso) => {
    if (!isWeekday(iso)) return null;
    const offset = usSummerTime(iso) ? "-04:00" : "-05:00";
    return { open: Date.parse(`${iso}T09:30:00${offset}`), close: Date.parse(`${iso}T16:00:00${offset}`) };
  },
};

export const SESSION_IDS: readonly SessionId[] = ["NSE", "MCX", "NYSE"];

function istClock(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(11, 16);
}

/** Whether each market is trading at `nowMs`, and when it next opens or closes. */
export function sessionsAt(nowMs: number): Session[] {
  const istToday = istDateString(nowMs);
  return SESSION_IDS.map((id) => {
    // New York's date runs behind India's: the session that is on right now may be dated yesterday here.
    const start = id === "NYSE" ? addDays(istToday, -1) : istToday;
    for (let i = 0; i < 10; i++) {
      const window = WINDOWS[id](addDays(start, i));
      if (!window || nowMs >= window.close) continue;
      const open = nowMs >= window.open;
      const at = open ? window.close : window.open;
      return { id, open, at, clock: istClock(at) };
    }
    return { id, open: false, at: nowMs, clock: istClock(nowMs) };
  });
}

/** "2d 4h", "3h 12m", "42m" - the two biggest units of a wait; "<1m" under a minute. */
export function compactDuration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 1) return "<1m";
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// --- The board --------------------------------------------------------------------------

/** The `n` biggest risers (biggest first) and the `n` biggest fallers (biggest first) - only moves that are real, not a flat or missing quote. */
export function moversOf(entries: readonly BoardEntry[], n = 2): { up: BoardEntry[]; down: BoardEntry[] } {
  const moving = byMoveDescending(entries).filter((e) => e.quote?.changePct != null && moveDirection(e.quote.changePct) !== "flat");
  return {
    up: moving.filter((e) => moveDirection(e.quote?.changePct ?? null) === "up").slice(0, n),
    down: moving
      .filter((e) => moveDirection(e.quote?.changePct ?? null) === "down")
      .slice(-n)
      .reverse(),
  };
}

// --- Open positions ---------------------------------------------------------------------

export type PositionLine = {
  id: string;
  /** "NIFTY 25400 CE", "NATURALGAS FUT" - as the Live Portfolio names it. */
  label: string;
  side: "buy" | "sell";
  lots: number;
  /** What it was entered at. */
  entry: number;
  /** Its live price; null while it has none. */
  live: number | null;
  /** Live P&L; null while the position has no price. */
  pnl: number | null;
};

/** The open positions, the biggest P&L - gain or loss - first, those without a price last. */
export function positionLines(rows: readonly PortfolioRow[]): PositionLine[] {
  const lines = rows.map((row) => ({
    id: row.entry.id,
    label: describeEntryContract(row.entry),
    side: row.entry.side,
    lots: row.entry.lots,
    entry: row.entryPrice,
    live: row.liveLtp ?? null,
    pnl: row.livePnl != null && Number.isFinite(row.livePnl) ? row.livePnl : null,
  }));
  return lines.sort((a, b) => (a.pnl === null ? 1 : b.pnl === null ? -1 : Math.abs(b.pnl) - Math.abs(a.pnl)));
}

/**
 * What the open positions control, gross: every position's lots x the lot size x the price of what it is written on (the underlying for an
 * option, the future's own price for a future), longs and shorts both counted. A position with no price yet adds nothing.
 */
export function exposureOf(rows: readonly PortfolioRow[]): number {
  let total = 0;
  for (const row of rows) {
    const price = row.underlyingSpot ?? row.liveLtp;
    if (price != null && Number.isFinite(price)) total += row.entry.lots * DEFAULT_LOT_SIZES[row.entry.instrument] * price;
  }
  return total;
}

// --- Expiries ---------------------------------------------------------------------------

export type ExpiryStep = {
  /** yyyy-mm-dd. */
  date: string;
  /** Whole days from today (India) to it: 0 on the day itself. */
  days: number;
  /** Lots held that expire then. */
  lots: number;
  positions: number;
};

/** The next `limit` dates on which open positions expire, nearest first, with what expires on each. A date whose session has already ended is past. */
export function expiryLadder(entries: readonly Pick<TradeEntry, "instrument" | "expiry_date" | "lots">[], nowMs: number, limit = 3): ExpiryStep[] {
  const today = istDateString(nowMs);
  const byDate = new Map<string, ExpiryStep>();
  for (const entry of entries) {
    if (!entry.expiry_date || !(expiryCloseMs(entry.expiry_date, entry.instrument) > nowMs)) continue;
    const step = byDate.get(entry.expiry_date) ?? { date: entry.expiry_date, days: daysBetween(today, entry.expiry_date), lots: 0, positions: 0 };
    step.lots += entry.lots;
    step.positions += 1;
    byDate.set(entry.expiry_date, step);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(0, limit);
}

// --- The last 30 days -------------------------------------------------------------------

/** What Reports opens on - every segment, the last 30 days - and the dates its charges are asked for. */
export function briefWindow(now: Date = new Date()): { from: string; to: string } {
  return reportWindow("30d", undefined, now);
}

/** Reports' own summary of the last 30 days of Upstox's P&L report (all segments); `charges` is Upstox's figure for the same window, or null while it is on its way. */
export function reportBrief(trades: readonly UpstoxReportTrade[], charges: number | null, now: Date = new Date()): ReportSummary {
  const segments = segmentsOfScope("ALL");
  const inScope = trades.filter((t) => segments.includes(t.segment));
  return summarizeTrades(filterEntriesByRange(inScope, "30d", undefined, now), charges ?? 0);
}

export type DayBar = {
  /** yyyy-mm-dd. */
  date: string;
  /** What closed that day, or null on a day nothing did. */
  pnl: number | null;
};

/** One slot per weekday of the last `days` calendar days ending `today`, oldest first: the P&L that closed that day (by closing date, as the calendar in Reports does), or null. */
export function dailyBars(trades: readonly ReportTrade[], today: string, days = 30): DayBar[] {
  const byDay = computeDailyPnlMap([...trades]);
  const bars: DayBar[] = [];
  for (let back = days - 1; back >= 0; back--) {
    const date = addDays(today, -back);
    if (isWeekday(date)) bars.push({ date, pnl: byDay.get(date) ?? null });
  }
  return bars;
}

export type TradeLine = { id: string; label: string; date: string; pnl: number };

/** The `n` trades closed most recently, newest first. */
export function lastTrades(trades: readonly UpstoxReportTrade[], n = 4): TradeLine[] {
  return [...trades]
    .sort((a, b) => (a.closing_date !== b.closing_date ? (a.closing_date < b.closing_date ? 1 : -1) : a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
    .slice(0, n)
    .map((t) => ({ id: t.id, label: t.label, date: t.closing_date, pnl: t.pnl }));
}

// --- The account ------------------------------------------------------------------------

export type FundsBrief = {
  /** Pay-ins less payouts that have actually moved. */
  capital: number;
  /** Capital plus every closed trade's P&L - the growth line's last point on the Reports page. */
  equity: number;
  /** Equity's gain on capital, in percent; null without capital to divide by. */
  returnPct: number | null;
  /** Payouts already paid. */
  paidOut: number;
  /** Ledger rows not yet fully paid. */
  pending: number;
};

/** The Payment ledger and the closed trades, as the Reports page's account growth reads them. Null while the ledger is empty - there is no capital to speak of. */
export function fundsBrief(trades: readonly ReportTrade[], payments: readonly Payment[]): FundsBrief | null {
  if (payments.length === 0) return null;
  const growth = computeAccountGrowthSeries([...trades], [...payments]);
  const last = growth[growth.length - 1];
  const capital = last?.capital ?? 0;
  const equity = last?.equity ?? 0;
  return {
    capital,
    equity,
    returnPct: computeReturnPct(equity - capital, capital),
    paidOut: payments.filter((p) => p.type === "payout" && p.status === "paid").reduce((sum, p) => sum + p.payout_amount, 0),
    pending: payments.filter((p) => p.status !== "paid").length,
  };
}

export type PaperBrief = {
  open: number;
  closed: number;
  /** Booked P&L of the closed paper trades. */
  pnl: number;
  /** Share of the closed ones that made money; null with none closed. */
  winRatePct: number | null;
};

export function paperBrief(entries: readonly PaperTradeEntry[]): PaperBrief {
  const closed = entries.filter((e) => e.status === "squared_off");
  return {
    open: entries.length - closed.length,
    closed: closed.length,
    pnl: closed.reduce((sum, e) => sum + e.pnl, 0),
    winRatePct: closed.length > 0 ? (closed.filter((e) => e.pnl > 0).length / closed.length) * 100 : null,
  };
}

// --- The market -------------------------------------------------------------------------

export type Breadth = {
  up: number;
  down: number;
  flat: number;
  /** How many of the stocks had a move to count. */
  total: number;
  /** The biggest risers, biggest first. */
  leaders: HeatmapQuote[];
  /** The biggest fallers, biggest first. */
  laggards: HeatmapQuote[];
};

/** How many of an index's stocks are up, down and flat, and who is moving most - the Heatmap's own reading. Null until any stock has a move. */
export function breadthOf(quotes: readonly HeatmapQuote[] | null, n = 2): Breadth | null {
  const moving = (quotes ?? []).filter((q) => q.changePct !== null);
  if (moving.length === 0) return null;
  const out: Breadth = { up: 0, down: 0, flat: 0, total: moving.length, leaders: [], laggards: [] };
  for (const q of moving) out[moveDirection(q.changePct)]++;
  const byMove = [...moving].sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0));
  out.leaders = byMove.filter((q) => moveDirection(q.changePct) === "up").slice(0, n);
  out.laggards = byMove
    .filter((q) => moveDirection(q.changePct) === "down")
    .slice(-n)
    .reverse();
  return out;
}
