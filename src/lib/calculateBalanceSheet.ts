/**
 * Pure math for the columns shown alongside each trade entry — currently
 * just SL numbering and the weekday label, both derived here rather than
 * stored, so editing or deleting an entry can never leave a stale value
 * behind. No React, no Supabase.
 */

import type { TradeEntry } from "@/lib/types";

export type BalanceSheetRow = TradeEntry & {
  slNo: number;
  day: string;
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Sorted chronologically first, so SL NO reads top-to-bottom like the sheet. */
export function computeBalanceSheetRows(entries: TradeEntry[]): BalanceSheetRow[] {
  const sorted = [...entries].sort((a, b) => {
    if (a.entry_date !== b.entry_date) return a.entry_date < b.entry_date ? -1 : 1;
    return a.created_at < b.created_at ? -1 : 1;
  });

  return sorted.map((entry, index) => ({
    ...entry,
    slNo: index + 1,
    day: DAY_NAMES[new Date(`${entry.entry_date}T00:00:00`).getDay()],
  }));
}
