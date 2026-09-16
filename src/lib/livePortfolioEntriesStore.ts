/**
 * Supabase-backed persistence for Live Portfolio — its own table
 * (live_portfolio_entries) so tracking a real position's live LTP/Greeks
 * never depends on (or writes back to) trade_entries. Same shape and
 * lifecycle as tradeEntriesStore.ts/paperTradeEntriesStore.ts, just a
 * different table underneath — reuses their pure helpers (calculateEntryPnl,
 * describeEntryContract) rather than reimplementing either.
 */

import { logEvent } from "@/lib/activityLog";
import { createClient } from "@/lib/supabase/client";
import { subscribeToTableChanges } from "@/lib/supabase/realtime";
import { calculateEntryPnl, type AddTradeEntryInput } from "@/lib/tradeEntriesStore";
import type { LivePortfolioEntry } from "@/lib/types";

export { calculateEntryPnl, describeEntryContract } from "@/lib/tradeEntriesStore";
export type { AddTradeEntryInput } from "@/lib/tradeEntriesStore";

const supabase = createClient();

/** Last-known result, kept warm so revisiting the tab paints instantly instead of flashing a skeleton. */
let cachedEntries: LivePortfolioEntry[] | null = null;

/** Synchronous — for a view's initial state, so it can skip the skeleton on a repeat visit. */
export function getCachedLivePortfolioEntries(): LivePortfolioEntry[] | null {
  return cachedEntries;
}

export async function getLivePortfolioEntries(): Promise<LivePortfolioEntry[]> {
  const { data, error } = await supabase
    .from("live_portfolio_entries")
    .select("*")
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  cachedEntries = data ?? [];
  return cachedEntries;
}

export async function addLivePortfolioEntry(input: AddTradeEntryInput): Promise<void> {
  const pnl = calculateEntryPnl(input);
  const { error } = await supabase.from("live_portfolio_entries").insert({
    entry_date: input.entryDate,
    instrument: input.instrument,
    strike_price: input.strikePrice ?? null,
    option_type: input.optionType ?? null,
    expiry_date: input.expiryDate ?? null,
    closing_date: input.closingDate ?? null,
    lots: input.lots,
    side: input.side,
    buy_price: input.buyPrice,
    sell_price: input.sellPrice,
    pnl,
    status: input.status,
    remarks: input.remarks?.trim() || null,
  });
  if (error) throw error;
  logEvent(
    `Added live portfolio position: ${input.instrument} ${input.side}, ${input.lots} lot${input.lots === 1 ? "" : "s"}`,
  );
}

export async function updateLivePortfolioEntry(id: string, input: AddTradeEntryInput): Promise<void> {
  const pnl = calculateEntryPnl(input);
  const { error } = await supabase
    .from("live_portfolio_entries")
    .update({
      entry_date: input.entryDate,
      instrument: input.instrument,
      strike_price: input.strikePrice ?? null,
      option_type: input.optionType ?? null,
      expiry_date: input.expiryDate ?? null,
      closing_date: input.closingDate ?? null,
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
  logEvent(
    `Edited live portfolio position: ${input.instrument} ${input.side}, ${input.lots} lot${input.lots === 1 ? "" : "s"}`,
  );
}

/** Same "single-field, bypasses the form's all-or-nothing rule" case as tradeEntriesStore's setTradeEntryExpiry. */
export async function setLivePortfolioExpiry(id: string, expiryDate: string): Promise<void> {
  const { error } = await supabase
    .from("live_portfolio_entries")
    .update({ expiry_date: expiryDate, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
  logEvent(`Set expiry date for live portfolio position to ${expiryDate}`);
}

export async function deleteLivePortfolioEntry(id: string): Promise<void> {
  const { data: entry, error } = await supabase
    .from("live_portfolio_entries")
    .delete()
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (entry) logEvent(`Deleted live portfolio position: ${entry.entry_date}`);
}

/** Keeps every open session in sync via Supabase Realtime, same as tradeEntriesStore.ts. */
export function subscribeToLivePortfolioChanges(callback: () => void): () => void {
  return subscribeToTableChanges("live_portfolio_entries", callback);
}
