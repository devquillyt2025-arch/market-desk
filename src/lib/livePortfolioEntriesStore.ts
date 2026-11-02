/**
 * Supabase-backed persistence for Live Portfolio — its own table
 * (live_portfolio_entries) so tracking a real position's live LTP/Greeks
 * never depends on (or writes back to) trade_entries. Same shape and
 * lifecycle as tradeEntriesStore.ts/paperTradeEntriesStore.ts, just a
 * different table underneath — reuses their pure helpers (calculateEntryPnl,
 * describeEntryContract) rather than reimplementing either.
 *
 * Its open rows are a mirror of the Upstox account's open positions, kept in
 * step by syncLivePortfolioWithUpstox — there's no manual add any more;
 * what-if positions belong in Paper Trade.
 */

import { logEvent } from "@/lib/activityLog";
import { createClient } from "@/lib/supabase/client";
import { subscribeToTableChanges } from "@/lib/supabase/realtime";
import { calculateEntryPnl, type AddTradeEntryInput } from "@/lib/tradeEntriesStore";
import type { LivePortfolioEntry } from "@/lib/types";
import type { UpstoxPosition } from "@/lib/upstox/types";
import { planPositionSync } from "@/lib/upstoxSync";

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

export type PositionSyncResult = { added: number; updated: number; closed: number };

let syncInflight: Promise<PositionSyncResult> | null = null;

/**
 * A UUID derived from `key` rather than random, so two devices syncing the
 * same new position at the same moment upsert one row instead of inserting
 * two. 128 bits of the non-cryptographic cyrb128 hash rather than
 * crypto.subtle, which only exists on https/localhost — the sync runs every
 * minute, and would fail outright on the dev server opened over the LAN.
 */
function idForPosition(key: string): string {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < key.length; i++) {
    const k = key.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  const hex = [h1, h2, h3, h4].map((h) => (h >>> 0).toString(16).padStart(8, "0")).join("");
  // Version 5-style (name-based) and RFC 4122 variant nibbles, so it reads as a well-formed UUID.
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20)}`;
}

/**
 * Brings the open rows in line with Upstox's positions (see planPositionSync
 * for the rules) in one bulk upsert. Reads the table fresh rather than
 * trusting the cache, so two syncs in a row can't both insert the same new
 * position; a second call while one is running just waits on the first.
 */
export function syncLivePortfolioWithUpstox(positions: UpstoxPosition[], today: string): Promise<PositionSyncResult> {
  syncInflight ??= (async () => {
    const plan = planPositionSync(await getLivePortfolioEntries(), positions, today);
    const now = new Date().toISOString();
    const rows = [
      ...plan.inserts.map(({ key, input }) => ({ id: idForPosition(key), input })),
      ...plan.updates.map(({ entry, input }) => ({ id: entry.id, input })),
      ...plan.closes.map(({ entry, input }) => ({ id: entry.id, input })),
    ].map(({ id, input }) => ({
      // Every row needs the same keys for a single bulk upsert statement —
      // which is why new rows get their id here rather than from the database.
      id,
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
      pnl: calculateEntryPnl(input),
      status: input.status,
      remarks: input.remarks?.trim() || null,
      updated_at: now,
    }));
    if (rows.length === 0) return { added: 0, updated: 0, closed: 0 };

    const { error } = await supabase.from("live_portfolio_entries").upsert(rows, { onConflict: "id" });
    if (error) throw error;

    const result = { added: plan.inserts.length, updated: plan.updates.length, closed: plan.closes.length };
    logEvent(`Synced live portfolio from Upstox: ${result.added} added, ${result.updated} updated, ${result.closed} closed`);
    return result;
  })().finally(() => {
    syncInflight = null;
  });
  return syncInflight;
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
