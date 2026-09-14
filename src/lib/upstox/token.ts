/**
 * Server-only: reads the Upstox access token via the service-role key,
 * bypassing RLS (there is none yet, same as every other table, but this is
 * the one credential in this app worth not routing through the public anon
 * client regardless). Only ever imported from the option-chain route —
 * never from a "use client" component.
 */

import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/types";

function serviceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. " +
        "The latter is server-only — set it in Vercel's env vars (or .env.local for local dev), never NEXT_PUBLIC_-prefixed.",
    );
  }

  return createClient<Database>(url, serviceRoleKey);
}

/** Null when no token has ever been saved at /settings. */
export async function getUpstoxAccessToken(): Promise<string | null> {
  const supabase = serviceRoleClient();
  const { data, error } = await supabase
    .from("upstox_config")
    .select("access_token")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw error;
  return data?.access_token ?? null;
}
