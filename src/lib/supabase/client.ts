import { createBrowserClient } from "@supabase/ssr";

import { supabaseEnv } from "@/lib/supabase/env";
import type { Database } from "@/lib/types";

export function createClient() {
  const { url, key } = supabaseEnv();
  return createBrowserClient<Database>(url, key);
}
