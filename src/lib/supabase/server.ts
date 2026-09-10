import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

import { supabaseEnv } from "@/lib/supabase/env";
import type { Database } from "@/lib/types";

export async function createClient() {
  const cookieStore = await cookies();
  const { url, key } = supabaseEnv();

  return createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      // Annotated because the cookie option is a union type, so TypeScript
      // can't contextually infer these parameters.
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from a Server Component, which cannot write cookies.
          // There's no middleware session to refresh here (no auth yet),
          // so this is a no-op rather than a real problem.
        }
      },
    },
  });
}
