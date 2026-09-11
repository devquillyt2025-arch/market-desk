import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

/**
 * Subscribes to every change on a table via Supabase Realtime and invokes
 * `callback`. Shared by tradeStore/linksStore/activityLog/tradeEntriesStore,
 * which all just want "something changed, refetch" rather than the changed
 * row itself. Returns an unsubscribe function.
 */
export function subscribeToTableChanges(table: string, callback: () => void): () => void {
  const channel = supabase
    .channel(`${table}-changes`)
    .on("postgres_changes", { event: "*", schema: "public", table }, () => {
      callback();
    })
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
