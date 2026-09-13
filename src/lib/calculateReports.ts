/**
 * Pure aggregation for the Reports tab. No React, no Supabase — takes the
 * same TradeEntry[] the Trade Entries table already fetches and reduces it
 * into the shapes each chart needs.
 */

import { round2 } from "@/lib/calculateTrade";
import { INSTRUMENT_LABELS, INSTRUMENTS, type Instrument, type TradeEntry } from "@/lib/types";

export const DATE_RANGES = ["7d", "30d", "90d", "all"] as const;
export type DateRange = (typeof DATE_RANGES)[number];

export const DATE_RANGE_LABELS: Record<DateRange, string> = {
  "7d": "7D",
  "30d": "30D",
  "90d": "90D",
  all: "All",
};

export function filterEntriesByRange(entries: TradeEntry[], range: DateRange): TradeEntry[] {
  if (range === "all") return entries;
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  return entries.filter((e) => e.entry_date >= cutoffIso);
}

export type ReportSummary = {
  totalPnl: number;
  totalTrades: number;
  winCount: number;
  lossCount: number;
  winRatePct: number;
  avgPnl: number;
  squaredOffCount: number;
  holdCount: number;
};

export function summarizeEntries(entries: TradeEntry[]): ReportSummary {
  const totalTrades = entries.length;
  const totalPnl = round2(entries.reduce((sum, e) => sum + e.pnl, 0));
  const winCount = entries.filter((e) => e.pnl > 0).length;
  const lossCount = entries.filter((e) => e.pnl < 0).length;
  const squaredOffCount = entries.filter((e) => e.status === "squared_off").length;

  return {
    totalPnl,
    totalTrades,
    winCount,
    lossCount,
    winRatePct: totalTrades > 0 ? round2((winCount / totalTrades) * 100) : 0,
    avgPnl: totalTrades > 0 ? round2(totalPnl / totalTrades) : 0,
    squaredOffCount,
    holdCount: totalTrades - squaredOffCount,
  };
}

function sortByDate(entries: TradeEntry[]): TradeEntry[] {
  return [...entries].sort((a, b) => {
    if (a.entry_date !== b.entry_date) return a.entry_date < b.entry_date ? -1 : 1;
    return a.created_at < b.created_at ? -1 : 1;
  });
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
