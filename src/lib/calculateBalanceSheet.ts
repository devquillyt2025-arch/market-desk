/**
 * Pure math for the balance-sheet columns shown alongside each trade entry.
 * No React, no Supabase — closing balance, Fund, and PNL(K) are all derived
 * here from each entry's own `pnl` plus the starting fund, rather than
 * stored, so editing or deleting an entry can never leave a stale running
 * total in the database.
 */

import type { TradeEntry } from "@/lib/types";

export type BalanceSheetRow = TradeEntry & {
  slNo: number;
  day: string;
  closingBalance: number;
  pnlK: number;
  fund: number;
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Sorted chronologically first, so SL NO and the running balance both read top-to-bottom like the sheet. */
export function computeBalanceSheetRows(entries: TradeEntry[], startingFund: number): BalanceSheetRow[] {
  const sorted = [...entries].sort((a, b) => {
    if (a.entry_date !== b.entry_date) return a.entry_date < b.entry_date ? -1 : 1;
    return a.created_at < b.created_at ? -1 : 1;
  });

  let closingBalance = 0;

  return sorted.map((entry, index) => {
    closingBalance += entry.pnl;

    return {
      ...entry,
      slNo: index + 1,
      day: DAY_NAMES[new Date(`${entry.entry_date}T00:00:00`).getDay()],
      closingBalance,
      pnlK: closingBalance / 1000,
      fund: startingFund + closingBalance,
    };
  });
}
