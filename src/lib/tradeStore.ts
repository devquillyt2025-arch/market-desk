/**
 * Local-only persistence for trades. Shaped like the eventual Supabase-backed
 * store (same `TradeWithLegs` rows, async functions) so swapping the body of
 * these functions for real queries later doesn't touch any call site.
 */

import { logEvent } from "@/lib/activityLog";
import { formatINR } from "@/lib/format";
import { INSTRUMENT_LABELS, type Instrument, type SaveTradeLegInput, type TradeWithLegs } from "@/lib/types";

const STORAGE_KEY = "marketdesk:trades";

export type SaveTradeInput = {
  instrument: Instrument;
  lots: number;
  lotSize: number;
  qty: number;
  totalNet: number;
  totalPnl: number;
  legs: SaveTradeLegInput[];
};

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `trade_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function readAll(): TradeWithLegs[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(trades: TradeWithLegs[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trades));
}

export async function getTrades(): Promise<TradeWithLegs[]> {
  return readAll();
}

export async function saveTrade(input: SaveTradeInput): Promise<TradeWithLegs> {
  try {
    const now = new Date().toISOString();
    const tradeId = uuid();

    const trade: TradeWithLegs = {
      id: tradeId,
      user_id: null,
      instrument: input.instrument,
      trade_date: now,
      lots: input.lots,
      lot_size: input.lotSize,
      qty: input.qty,
      total_net: input.totalNet,
      total_pnl: input.totalPnl,
      created_at: now,
      legs: input.legs.map((leg) => ({
        id: uuid(),
        trade_id: tradeId,
        sell_price: leg.sell_price,
        buy_price: leg.buy_price,
        net: leg.net,
        leg_order: leg.leg_order,
        created_at: now,
      })),
    };

    writeAll([trade, ...readAll()]);
    logEvent(
      `Saved trade: ${INSTRUMENT_LABELS[input.instrument]}, Qty ${input.qty}, P&L ${formatINR(input.totalPnl)}`,
    );
    return trade;
  } catch (err) {
    logEvent(`Failed to save trade: ${err instanceof Error ? err.message : "unknown error"}`);
    throw err;
  }
}

export async function deleteTrade(id: string): Promise<void> {
  const trades = readAll();
  const trade = trades.find((t) => t.id === id);
  writeAll(trades.filter((t) => t.id !== id));
  if (trade) {
    logEvent(`Deleted trade: ${INSTRUMENT_LABELS[trade.instrument]}, Qty ${trade.qty}`);
  }
}

export async function clearTrades(): Promise<void> {
  const count = readAll().length;
  writeAll([]);
  if (count > 0) logEvent(`Cleared all trades (${count} removed)`);
}
