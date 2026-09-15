/**
 * Supabase-backed persistence for Paper Trade — a sandbox mirror of
 * tradeEntriesStore.ts pointed at its own table (paper_trade_entries) so
 * experimenting with a position never touches real P&L, Reports, or the
 * Payment ledger. Reuses tradeEntriesStore's pure helpers (calculateEntryPnl,
 * describeEntryContract) rather than reimplementing them — same formula,
 * same contract-label convention, just a different table underneath.
 */

import { logEvent } from "@/lib/activityLog";
import { createClient } from "@/lib/supabase/client";
import { subscribeToTableChanges } from "@/lib/supabase/realtime";
import { calculateEntryPnl, type AddTradeEntryInput } from "@/lib/tradeEntriesStore";
import type { PaperTradeEntry } from "@/lib/types";

export { calculateEntryPnl, describeEntryContract } from "@/lib/tradeEntriesStore";
export type { AddTradeEntryInput } from "@/lib/tradeEntriesStore";

const supabase = createClient();

/** Last-known result, kept warm so revisiting the tab paints instantly instead of flashing a skeleton. */
let cachedEntries: PaperTradeEntry[] | null = null;

/** Synchronous — for a view's initial state, so it can skip the skeleton on a repeat visit. */
export function getCachedPaperTradeEntries(): PaperTradeEntry[] | null {
  return cachedEntries;
}

export async function getPaperTradeEntries(): Promise<PaperTradeEntry[]> {
  const { data, error } = await supabase
    .from("paper_trade_entries")
    .select("*")
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  cachedEntries = data ?? [];
  return cachedEntries;
}

export async function addPaperTradeEntry(input: AddTradeEntryInput): Promise<void> {
  const pnl = calculateEntryPnl(input);
  const { error } = await supabase.from("paper_trade_entries").insert({
    entry_date: input.entryDate,
    instrument: input.instrument,
    strike_price: input.strikePrice ?? null,
    option_type: input.optionType ?? null,
    expiry_date: input.expiryDate ?? null,
    lots: input.lots,
    side: input.side,
    buy_price: input.buyPrice,
    sell_price: input.sellPrice,
    pnl,
    status: input.status,
    remarks: input.remarks?.trim() || null,
  });
  if (error) throw error;
  logEvent(`Added paper trade: ${input.instrument} ${input.side}, ${input.lots} lot${input.lots === 1 ? "" : "s"}`);
}

export async function updatePaperTradeEntry(id: string, input: AddTradeEntryInput): Promise<void> {
  const pnl = calculateEntryPnl(input);
  const { error } = await supabase
    .from("paper_trade_entries")
    .update({
      entry_date: input.entryDate,
      instrument: input.instrument,
      strike_price: input.strikePrice ?? null,
      option_type: input.optionType ?? null,
      expiry_date: input.expiryDate ?? null,
      lots: input.lots,
      side: input.side,
      buy_price: input.buyPrice,
      sell_price: input.sellPrice,
      pnl,
      status: input.status,
      remarks: input.remarks?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
  logEvent(`Edited paper trade: ${input.instrument} ${input.side}, ${input.lots} lot${input.lots === 1 ? "" : "s"}`);
}

/** Same "single-field, bypasses the form's all-or-nothing rule" case as tradeEntriesStore's setTradeEntryExpiry. */
export async function setPaperTradeExpiry(id: string, expiryDate: string): Promise<void> {
  const { error } = await supabase
    .from("paper_trade_entries")
    .update({ expiry_date: expiryDate, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
  logEvent(`Set expiry date for paper trade to ${expiryDate}`);
}

export async function deletePaperTradeEntry(id: string): Promise<void> {
  const { data: entry, error } = await supabase
    .from("paper_trade_entries")
    .delete()
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (entry) logEvent(`Deleted paper trade: ${entry.entry_date}`);
}

/** Keeps every open session in sync via Supabase Realtime, same as tradeEntriesStore.ts. */
export function subscribeToPaperTradeChanges(callback: () => void): () => void {
  return subscribeToTableChanges("paper_trade_entries", callback);
}
