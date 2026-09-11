/**
 * Supabase-backed persistence for trades. `save_trade` inserts the trade and
 * its legs atomically server-side (see the migration) — a plain client-side
 * insert-then-insert would leave an orphaned trade row if the legs insert
 * failed partway through.
 */

import { logEvent } from "@/lib/activityLog";
import { formatINR } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { subscribeToTableChanges } from "@/lib/supabase/realtime";
import {
  INSTRUMENT_LABELS,
  type Instrument,
  type SaveTradeLegInput,
  type TradeLeg,
  type TradeWithLegs,
} from "@/lib/types";

const supabase = createClient();

export type SaveTradeInput = {
  instrument: Instrument;
  lots: number;
  lotSize: number;
  qty: number;
  totalNet: number;
  totalPnl: number;
  legs: SaveTradeLegInput[];
};

/**
 * Last-known result, kept warm so revisiting History after switching tabs
 * away and back can paint instantly instead of flashing a loading skeleton
 * while it refetches over the network.
 */
let cachedTrades: TradeWithLegs[] | null = null;

/** Synchronous — for a view's initial state, so it can skip the skeleton on a repeat visit. */
export function getCachedTrades(): TradeWithLegs[] | null {
  return cachedTrades;
}

export async function getTrades(): Promise<TradeWithLegs[]> {
  const { data: trades, error: tradesError } = await supabase
    .from("trades")
    .select("*")
    .order("created_at", { ascending: false });
  if (tradesError) throw tradesError;
  if (!trades || trades.length === 0) {
    cachedTrades = [];
    return cachedTrades;
  }

  const { data: legs, error: legsError } = await supabase
    .from("trade_legs")
    .select("*")
    .in(
      "trade_id",
      trades.map((trade) => trade.id),
    )
    .order("leg_order", { ascending: true });
  if (legsError) throw legsError;

  const legsByTrade = new Map<string, TradeLeg[]>();
  for (const leg of legs ?? []) {
    const forTrade = legsByTrade.get(leg.trade_id);
    if (forTrade) forTrade.push(leg);
    else legsByTrade.set(leg.trade_id, [leg]);
  }

  cachedTrades = trades.map((trade) => ({ ...trade, legs: legsByTrade.get(trade.id) ?? [] }));
  return cachedTrades;
}

export async function saveTrade(input: SaveTradeInput): Promise<TradeWithLegs> {
  try {
    const { data: tradeId, error: rpcError } = await supabase.rpc("save_trade", {
      p_instrument: input.instrument,
      p_lots: input.lots,
      p_lot_size: input.lotSize,
      p_qty: input.qty,
      p_total_net: input.totalNet,
      p_total_pnl: input.totalPnl,
      p_legs: input.legs,
    });
    if (rpcError) throw rpcError;

    const [{ data: trade, error: tradeError }, { data: legs, error: legsError }] = await Promise.all([
      supabase.from("trades").select("*").eq("id", tradeId).single(),
      supabase.from("trade_legs").select("*").eq("trade_id", tradeId).order("leg_order", { ascending: true }),
    ]);
    if (tradeError) throw tradeError;
    if (legsError) throw legsError;

    logEvent(
      `Saved trade: ${INSTRUMENT_LABELS[input.instrument]}, Qty ${input.qty}, P&L ${formatINR(input.totalPnl)}`,
    );
    return { ...trade, legs: legs ?? [] };
  } catch (err) {
    logEvent(`Failed to save trade: ${err instanceof Error ? err.message : "unknown error"}`);
    throw err;
  }
}

export async function deleteTrade(id: string): Promise<void> {
  const { data: trade, error } = await supabase.from("trades").delete().eq("id", id).select().maybeSingle();
  if (error) throw error;
  if (trade) {
    logEvent(`Deleted trade: ${INSTRUMENT_LABELS[trade.instrument]}, Qty ${trade.qty}`);
  }
}

export async function clearTrades(): Promise<void> {
  const { count, error: countError } = await supabase
    .from("trades")
    .select("*", { count: "exact", head: true });
  if (countError) throw countError;
  if (!count) return;

  const { error } = await supabase.from("trades").delete().not("id", "is", null);
  if (error) throw error;

  logEvent(`Cleared all trades (${count} removed)`);
}

/** Keeps every open session in sync via Supabase Realtime, same as notesStore.ts. */
export function subscribeToTradeChanges(callback: () => void): () => void {
  return subscribeToTableChanges("trades", callback);
}
