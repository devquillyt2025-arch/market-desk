/**
 * Pure math for the balance-sheet columns shown alongside each trade entry.
 * No React, no Supabase — closing balance and PNL(K) are derived here from
 * each entry's own `pnl`, rather than stored, so editing or deleting an
 * entry can never leave a stale running total in the database.
 */

import { round2 } from "@/lib/calculateTrade";
import type { TradeEntry } from "@/lib/types";

export type BalanceSheetRow = TradeEntry & {
  slNo: number;
  day: string;
  closingBalance: number;
  pnlK: number;
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Sorted chronologically first, so SL NO and the running balance both read top-to-bottom like the sheet. */
export function computeBalanceSheetRows(entries: TradeEntry[]): BalanceSheetRow[] {
  const sorted = [...entries].sort((a, b) => {
    if (a.entry_date !== b.entry_date) return a.entry_date < b.entry_date ? -1 : 1;
    return a.created_at < b.created_at ? -1 : 1;
  });

  let closingBalance = 0;

  return sorted.map((entry, index) => {
    // Rounded on every step, not just on display — an unrounded running sum
    // accumulates binary floating-point drift (e.g. repeated 0.1 + 0.2
    // additions) that can surface as an off-by-a-paisa balance a few hundred
    // rows down the ledger.
    closingBalance = round2(closingBalance + entry.pnl);

    return {
      ...entry,
      slNo: index + 1,
      day: DAY_NAMES[new Date(`${entry.entry_date}T00:00:00`).getDay()],
      closingBalance,
      pnlK: round2(closingBalance / 1000),
    };
  });
}
