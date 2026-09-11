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
  remarks?: string;
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
    remarks: input.remarks?.trim() || null,
  });
  if (error) throw error;
  logEvent(
    `Added trade entry: ${INSTRUMENT_LABELS[input.instrument]} ${input.side}, ${input.lots} lot${input.lots === 1 ? "" : "s"}, P&L ${formatINR(pnl)}`,
  );
}

export async function updateTradeEntry(id: string, input: AddTradeEntryInput): Promise<void> {
  const pnl = calculateEntryPnl(input);
  const { error } = await supabase
    .from("trade_entries")
    .update({
      entry_date: input.entryDate,
      instrument: input.instrument,
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
    `Edited trade entry: ${INSTRUMENT_LABELS[input.instrument]} ${input.side}, ${input.lots} lot${input.lots === 1 ? "" : "s"}, P&L ${formatINR(pnl)}`,
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

/** Kept warm for the same reason as cachedEntries above. */
let cachedStartingFund: number | null = null;

export function getCachedStartingFund(): number | null {
  return cachedStartingFund;
}

/** The balance sheet's starting capital — used to derive Fund and Overall % Ret alongside each entry's own pnl. */
export async function getStartingFund(): Promise<number> {
  const { data, error } = await supabase
    .from("balance_sheet_settings")
    .select("starting_fund")
    .limit(1)
    .single();
  if (error) throw error;
  cachedStartingFund = data.starting_fund;
  return cachedStartingFund;
}

export async function updateStartingFund(value: number): Promise<void> {
  const { error } = await supabase
    .from("balance_sheet_settings")
    .update({ starting_fund: value, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (error) throw error;
  logEvent(`Updated starting fund to ${value}`);
}

/** Keeps every open session in sync via Supabase Realtime — covers both the entries and the starting fund. */
export function subscribeToTradeEntryChanges(callback: () => void): () => void {
  const unsubscribeEntries = subscribeToTableChanges("trade_entries", callback);
  const unsubscribeSettings = subscribeToTableChanges("balance_sheet_settings", callback);
  return () => {
    unsubscribeEntries();
    unsubscribeSettings();
  };
}
