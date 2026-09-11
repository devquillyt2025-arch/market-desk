/**
 * Supabase-backed activity log. `logEvent` stays synchronous (fire-and-forget)
 * because every other store calls it inline after a mutation without
 * awaiting it — making it async would mean touching every call site for no
 * behavioral benefit, since none of them need to know when the log write
 * finishes.
 */

import { createClient } from "@/lib/supabase/client";
import { subscribeToTableChanges } from "@/lib/supabase/realtime";

const MAX_ENTRIES = 500;
/** Swallows duplicate calls from React re-invoking an effect twice in dev. Checked in-memory, not via a DB round-trip, since logEvent fires on nearly every action. */
const DEDUPE_WINDOW_MS = 300;

const supabase = createClient();

export type LogEntry = {
  id: string;
  timestamp: string;
  message: string;
};

let lastLogged: { message: string; at: number } | null = null;

export function logEvent(message: string): void {
  const now = Date.now();
  if (lastLogged && lastLogged.message === message && now - lastLogged.at < DEDUPE_WINDOW_MS) {
    return;
  }
  lastLogged = { message, at: now };

  void (async () => {
    try {
      const { error } = await supabase.from("activity_log").insert({ message });
      if (error) throw error;
    } catch (err) {
      console.error("Failed to record activity log entry:", err);
    }
  })();
}

/** Last-known result, kept warm so revisiting the tab paints instantly instead of flashing a skeleton. */
let cachedLogs: LogEntry[] | null = null;

/** Synchronous — for a view's initial state, so it can skip the skeleton on a repeat visit. */
export function getCachedLogs(): LogEntry[] | null {
  return cachedLogs;
}

export async function getLogs(): Promise<LogEntry[]> {
  const { data, error } = await supabase
    .from("activity_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(MAX_ENTRIES);
  if (error) throw error;
  cachedLogs = (data ?? []).map((row) => ({ id: row.id, timestamp: row.created_at, message: row.message }));
  return cachedLogs;
}

export async function clearLogs(): Promise<void> {
  const { error } = await supabase.from("activity_log").delete().not("id", "is", null);
  if (error) throw error;
}

/** Keeps every open session in sync via Supabase Realtime, same as notesStore.ts. */
export function subscribeToLogChanges(callback: () => void): () => void {
  return subscribeToTableChanges("activity_log", callback);
}
