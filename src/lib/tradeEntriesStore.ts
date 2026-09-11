/**
 * Supabase-backed persistence for the daily trade journal — one entry per
 * trading day with its own P&L and Squared Off/Hold status. Independent of
 * tradeStore.ts (the Brokerage Calculator's saved multi-leg trades).
 */

import { logEvent } from "@/lib/activityLog";
import { round2 } from "@/lib/calculateTrade";
import { formatINR } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { subscribeToTableChanges } from "@/lib/supabase/realtime";
import {
  DEFAULT_LOT_SIZES,
  INSTRUMENT_LABELS,
  TRADE_ENTRY_SIDES,
  TRADE_ENTRY_STATUSES,
  type Instrument,
  type TradeEntry,
  type TradeEntrySide,
  type TradeEntryStatus,
} from "@/lib/types";

export { TRADE_ENTRY_SIDES, TRADE_ENTRY_STATUSES, type TradeEntry, type TradeEntrySide, type TradeEntryStatus };

const supabase = createClient();

export type AddTradeEntryInput = {
  entryDate: string;
  instrument: Instrument;
  lots: number;
  side: TradeEntrySide;
  buyPrice: number;
  sellPrice: number;
  status: TradeEntryStatus;
};

/** Same formula as the Brokerage Calculator: (sell - buy) * lot size * lots. */
export function calculateEntryPnl(params: {
  instrument: Instrument;
  lots: number;
  buyPrice: number;
  sellPrice: number;
}): number {
  const net = round2(params.sellPrice - params.buyPrice);
  return round2(net * DEFAULT_LOT_SIZES[params.instrument] * params.lots);
}

/** Last-known result, kept warm so revisiting the tab paints instantly instead of flashing a skeleton. */
let cachedEntries: TradeEntry[] | null = null;

/** Synchronous — for a view's initial state, so it can skip the skeleton on a repeat visit. */
export function getCachedTradeEntries(): TradeEntry[] | null {
  return cachedEntries;
}

export async function getTradeEntries(): Promise<TradeEntry[]> {
  const { data, error } = await supabase
    .from("trade_entries")
    .select("*")
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  cachedEntries = data ?? [];
  return cachedEntries;
}

export async function addTradeEntry(input: AddTradeEntryInput): Promise<void> {
  const pnl = calculateEntryPnl(input);
  const { error } = await supabase.from("trade_entries").insert({
    entry_date: input.entryDate,
    instrument: input.instrument,
    lots: input.lots,
    side: input.side,
    buy_price: input.buyPrice,
    sell_price: input.sellPrice,
    pnl,
    status: input.status,
  });
  if (error) throw error;
  logEvent(
    `Added trade entry: ${INSTRUMENT_LABELS[input.instrument]} ${input.side}, ${input.lots} lot${input.lots === 1 ? "" : "s"}, P&L ${formatINR(pnl)}`,
  );
}

export async function setTradeEntryStatus(id: string, status: TradeEntryStatus): Promise<void> {
  const { error } = await supabase
    .from("trade_entries")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteTradeEntry(id: string): Promise<void> {
  const { data: entry, error } = await supabase
    .from("trade_entries")
    .delete()
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (entry) logEvent(`Deleted trade entry: ${entry.entry_date}`);
}

/** Keeps every open session in sync via Supabase Realtime, same as notesStore.ts. */
export function subscribeToTradeEntryChanges(callback: () => void): () => void {
  return subscribeToTableChanges("trade_entries", callback);
}
