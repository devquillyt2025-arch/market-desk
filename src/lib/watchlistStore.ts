/**
 * Supabase-backed persistence for the Watchlist page - the list itself (what is on it, in what order), never prices.
 * Same shape as linksStore.ts: a warm cache so revisiting the tab paints at once, optimistic callers that
 * roll back on failure, and Realtime to keep every device in step.
 *
 * The `watchlist_items` table comes from a migration. Until that has been run, reading it fails in a recognisable way
 * (`WatchlistStorageMissingError`), which the page turns into a read-only starting list and a note saying what to run,
 * rather than an empty screen and a toast.
 */

import { logEvent } from "@/lib/activityLog";
import { isOfferedCommodity } from "@/lib/mcxCommodities";
import { createClient } from "@/lib/supabase/client";
import { subscribeToTableChanges } from "@/lib/supabase/realtime";
import type { WatchlistItemRow } from "@/lib/types";
import type { WatchlistItem, WatchlistSeed } from "@/lib/watchlist";

const supabase = createClient();

/** The migration that creates the table - named in the message the page shows. */
export const WATCHLIST_MIGRATION = "supabase/migrations/20261112100000_watchlist.sql";

export class WatchlistStorageMissingError extends Error {
  constructor() {
    super(`The watchlist table doesn't exist yet - run ${WATCHLIST_MIGRATION}.`);
    this.name = "WatchlistStorageMissingError";
  }
}

/**
 * PostgREST says `PGRST205` ("could not find the table ... in the schema cache"); a direct Postgres error says `42P01`
 * (undefined_table). Either means the migration hasn't been run - not a failure worth retrying.
 */
export function isMissingTableError(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "PGRST205" || error.code === "42P01" || /watchlist_items.*(schema cache|does not exist)/i.test(error.message ?? "");
}

function fromRow(row: WatchlistItemRow): WatchlistItem {
  return { id: row.id, kind: row.kind, itemKey: row.item_key, symbol: row.symbol, name: row.name, sortOrder: row.sort_order };
}

/** Last-known result, kept warm so revisiting the tab paints instantly instead of flashing a loader. */
let cachedItems: WatchlistItem[] | null = null;

/** Synchronous - for a view's initial state. */
export function getCachedWatchlist(): WatchlistItem[] | null {
  return cachedItems;
}

export async function getWatchlist(): Promise<WatchlistItem[]> {
  const { data, error } = await supabase.from("watchlist_items").select("*").order("sort_order", { ascending: true }).order("created_at", { ascending: true });
  if (error) {
    if (isMissingTableError(error)) throw new WatchlistStorageMissingError();
    throw error;
  }
  // A saved commodity the app no longer offers (a row from before it was taken off the list) is left out of what the page shows, so the
  // list agrees with the search and the Heatmap whatever the table still holds. The row itself is not touched.
  cachedItems = (data ?? []).map(fromRow).filter((item) => item.kind !== "commodity" || isOfferedCommodity(item.symbol));
  return cachedItems;
}

/** Adds one instrument at `sortOrder`. Adding something already listed is not an error - it returns the existing row. */
export async function addWatchlistItem(seed: WatchlistSeed): Promise<WatchlistItem> {
  const { data, error } = await supabase
    .from("watchlist_items")
    .insert({ kind: seed.kind, item_key: seed.itemKey, symbol: seed.symbol, name: seed.name, sort_order: seed.sortOrder })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      // item_key is unique: another device added it first.
      const existing = await supabase.from("watchlist_items").select("*").eq("item_key", seed.itemKey).single();
      if (existing.data) return fromRow(existing.data);
    }
    if (isMissingTableError(error)) throw new WatchlistStorageMissingError();
    throw error;
  }
  logEvent(`Added to watchlist: ${seed.name}`);
  return fromRow(data);
}

export async function removeWatchlistItem(item: Pick<WatchlistItem, "id" | "name">): Promise<void> {
  const { error } = await supabase.from("watchlist_items").delete().eq("id", item.id);
  if (error) throw error;
  logEvent(`Removed from watchlist: ${item.name}`);
}

/** Writes new positions for the items passed (see changedPositions) - one statement, however many moved. */
export async function saveWatchlistOrder(items: readonly WatchlistItem[]): Promise<void> {
  if (items.length === 0) return;
  // An upsert needs every NOT NULL column, so the rows go whole - only `sort_order` actually differs.
  const rows = items.map((item) => ({ id: item.id, kind: item.kind, item_key: item.itemKey, symbol: item.symbol, name: item.name, sort_order: item.sortOrder }));
  const { error } = await supabase.from("watchlist_items").upsert(rows, { onConflict: "id" });
  if (error) throw error;
}

/** Keeps every open session in sync via Supabase Realtime, same as linksStore.ts. */
export function subscribeToWatchlistChanges(callback: () => void): () => void {
  return subscribeToTableChanges("watchlist_items", callback);
}
