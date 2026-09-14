/**
 * Browser-side read/write for the /settings page's Access Token section.
 * Deliberately no caching or Realtime subscription here (unlike every other
 * *Store.ts module) — this is a single row visited rarely, not worth the
 * machinery.
 */

import { logEvent } from "@/lib/activityLog";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

export type UpstoxConfig = {
  hasToken: boolean;
  updatedAt: string | null;
};

export async function getUpstoxConfig(): Promise<UpstoxConfig> {
  const { data, error } = await supabase
    .from("upstox_config")
    .select("access_token, updated_at")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw error;
  return { hasToken: Boolean(data?.access_token), updatedAt: data?.updated_at ?? null };
}

export async function saveUpstoxToken(token: string): Promise<void> {
  const { error } = await supabase
    .from("upstox_config")
    .update({ access_token: token, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) throw error;
  logEvent("Updated Upstox access token");
}
