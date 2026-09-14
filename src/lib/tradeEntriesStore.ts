/**
 * Supabase-backed persistence for the daily trade journal — one entry per
 * trading day with its own P&L and Squared Off/Hold status.
 */

import { logEvent } from "@/lib/activityLog";
import { round2 } from "@/lib/calculateTrade";
import { formatINR } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { subscribeToTableChanges } from "@/lib/supabase/realtime";
import {
  DEFAULT_LOT_SIZES,
  INSTRUMENT_LABELS,
  INSTRUMENTS,
  TRADE_ENTRY_OPTION_TYPES,
  TRADE_ENTRY_SIDES,
  TRADE_ENTRY_STATUSES,
  type Instrument,
  type TradeEntry,
  type TradeEntryOptionType,
  type TradeEntrySide,
  type TradeEntryStatus,
} from "@/lib/types";

export {
  TRADE_ENTRY_OPTION_TYPES,
  TRADE_ENTRY_SIDES,
  TRADE_ENTRY_STATUSES,
  type TradeEntry,
  type TradeEntryOptionType,
  type TradeEntrySide,
  type TradeEntryStatus,
};

const supabase = createClient();

export type AddTradeEntryInput = {
  entryDate: string;
  instrument: Instrument;
  strikePrice?: number;
  optionType?: TradeEntryOptionType;
  expiryDate?: string;
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

/** e.g. "NIFTY 23500 CE" when a strike/option type is set, else just the instrument label. */
function describeContract(input: Pick<AddTradeEntryInput, "instrument" | "strikePrice" | "optionType">): string {
  const label = INSTRUMENT_LABELS[input.instrument];
  return input.strikePrice && input.optionType ? `${label} ${input.strikePrice} ${input.optionType}` : label;
}

/**
 * Same idea as describeContract above, for an already-saved row (snake_case
 * DB columns) rather than form input — shared by any view displaying a
 * TradeEntry, so Trade Entries' table and Live Portfolio read identically.
 */
export function describeEntryContract(entry: Pick<TradeEntry, "instrument" | "strike_price" | "option_type">): string {
  return entry.strike_price != null && entry.option_type
    ? `${entry.instrument} ${entry.strike_price.toFixed(0)} ${entry.option_type}`
    : INSTRUMENT_LABELS[entry.instrument];
}

export async function addTradeEntry(input: AddTradeEntryInput): Promise<void> {
  const pnl = calculateEntryPnl(input);
  const { error } = await supabase.from("trade_entries").insert({
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
  logEvent(
    `Added trade entry: ${describeContract(input)} ${input.side}, ${input.lots} lot${input.lots === 1 ? "" : "s"}, P&L ${formatINR(pnl)}`,
  );
}

export async function updateTradeEntry(id: string, input: AddTradeEntryInput): Promise<void> {
  const pnl = calculateEntryPnl(input);
  const { error } = await supabase
    .from("trade_entries")
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
  logEvent(
    `Edited trade entry: ${describeContract(input)} ${input.side}, ${input.lots} lot${input.lots === 1 ? "" : "s"}, P&L ${formatINR(pnl)}`,
  );
}

export async function setTradeEntryStatus(id: string, status: TradeEntryStatus): Promise<void> {
  const { error } = await supabase
    .from("trade_entries")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/**
 * Narrow, single-field update — for Live Portfolio's inline "set expiry"
 * picker, used on rows that already have strike_price + option_type but
 * were saved before expiry_date existed (or had it skipped). Bypasses
 * TradeEntryModal's "all three or none" form rule on purpose: that's a
 * form-level UX guardrail for the create/edit flow, not a database
 * constraint, and completing a partial row here is exactly the case it
 * doesn't apply to.
 */
export async function setTradeEntryExpiry(id: string, expiryDate: string): Promise<void> {
  const { error } = await supabase
    .from("trade_entries")
    .update({ expiry_date: expiryDate, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
  logEvent(`Set expiry date for trade entry to ${expiryDate}`);
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

/** Shape accepted on import — a loosened TradeEntry: `id` optional (new row if absent/unmatched), server-only fields ignored. */
type ImportedTradeEntry = {
  id?: string;
  entry_date: string;
  instrument: Instrument;
  strike_price?: number | null;
  option_type?: TradeEntryOptionType | null;
  expiry_date?: string | null;
  lots: number;
  side: TradeEntrySide;
  buy_price: number;
  sell_price: number;
  status: TradeEntryStatus;
  remarks?: string | null;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidImportedEntry(value: unknown): value is ImportedTradeEntry {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    (v.id === undefined || (typeof v.id === "string" && UUID_PATTERN.test(v.id))) &&
    typeof v.entry_date === "string" &&
    !Number.isNaN(Date.parse(v.entry_date)) &&
    typeof v.instrument === "string" &&
    (INSTRUMENTS as readonly string[]).includes(v.instrument) &&
    typeof v.lots === "number" &&
    v.lots > 0 &&
    (v.side === "buy" || v.side === "sell") &&
    typeof v.buy_price === "number" &&
    typeof v.sell_price === "number" &&
    (v.status === "squared_off" || v.status === "hold") &&
    (v.strike_price === undefined || v.strike_price === null || typeof v.strike_price === "number") &&
    (v.option_type === undefined || v.option_type === null || TRADE_ENTRY_OPTION_TYPES.includes(v.option_type as TradeEntryOptionType)) &&
    (v.expiry_date === undefined || v.expiry_date === null || (typeof v.expiry_date === "string" && !Number.isNaN(Date.parse(v.expiry_date))))
  );
}

export type ImportTradeEntriesResult = {
  inserted: number;
  updated: number;
};

/**
 * Bulk upsert from an exported (or hand-edited) JSON array. Recomputes pnl
 * from each row's own prices rather than trusting an embedded value — an
 * edited file could carry a pnl that no longer matches its buy/sell price.
 */
export async function importTradeEntries(data: unknown): Promise<ImportTradeEntriesResult> {
  if (!Array.isArray(data)) throw new Error("Expected a JSON array of trade entries.");
  if (data.length === 0) return { inserted: 0, updated: 0 };

  const invalidIndex = data.findIndex((item) => !isValidImportedEntry(item));
  if (invalidIndex !== -1) {
    throw new Error(`Entry ${invalidIndex + 1} is missing a required field or has the wrong type.`);
  }
  const entries = data as ImportedTradeEntry[];

  const existingIds = new Set((cachedEntries ?? (await getTradeEntries())).map((e) => e.id));
  const now = new Date().toISOString();

  const rows = entries.map((entry) => {
    const pnl = calculateEntryPnl({
      instrument: entry.instrument,
      lots: entry.lots,
      buyPrice: entry.buy_price,
      sellPrice: entry.sell_price,
    });
    return {
      // Every row needs the same keys for a single bulk upsert statement —
      // generate an id here rather than omitting it for new entries.
      id: entry.id ?? crypto.randomUUID(),
      entry_date: entry.entry_date,
      instrument: entry.instrument,
      strike_price: entry.strike_price ?? null,
      option_type: entry.option_type ?? null,
      expiry_date: entry.expiry_date ?? null,
      lots: entry.lots,
      side: entry.side,
      buy_price: entry.buy_price,
      sell_price: entry.sell_price,
      pnl,
      status: entry.status,
      remarks: entry.remarks ?? null,
      updated_at: now,
    };
  });

  const { error } = await supabase.from("trade_entries").upsert(rows, { onConflict: "id" });
  if (error) throw error;

  const updated = entries.filter((e) => e.id && existingIds.has(e.id)).length;
  const inserted = entries.length - updated;
  logEvent(`Imported trade entries: ${inserted} added, ${updated} updated`);
  return { inserted, updated };
}

/** Keeps every open session in sync via Supabase Realtime, same as notesStore.ts. */
export function subscribeToTradeEntryChanges(callback: () => void): () => void {
  return subscribeToTableChanges("trade_entries", callback);
}
