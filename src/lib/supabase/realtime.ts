import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

/** Collapses a burst of events (e.g. every row of a bulk import) into one trailing refetch. */
const DEBOUNCE_MS = 250;

/**
 * Subscribes to every change on a table via Supabase Realtime and invokes
 * `callback`. Shared by linksStore/activityLog/tradeEntriesStore/paymentStore,
 * which all just want "something changed, refetch" rather than the changed
 * row itself. Returns an unsubscribe function.
 *
 * Debounced: Realtime fires once per changed row, so an operation touching
 * many rows (a bulk import, "clear all") would otherwise trigger that many
 * redundant, potentially out-of-order refetches in a row.
 */
export function subscribeToTableChanges(table: string, callback: () => void): () => void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const channel = supabase
    .channel(`${table}-changes`)
    .on("postgres_changes", { event: "*", schema: "public", table }, () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        callback();
      }, DEBOUNCE_MS);
    })
    .subscribe();

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    void supabase.removeChannel(channel);
  };
}
