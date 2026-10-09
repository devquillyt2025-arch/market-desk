"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  AUTH_COOKIE,
  clearFailures,
  createSession,
  pinMatches,
  recordFailure,
  retryAfterSeconds,
  safeNextPath,
} from "@/lib/pinAuth";

export type UnlockState = { error: string | null };

function formatWait(seconds: number): string {
  return seconds >= 90 ? `${Math.ceil(seconds / 60)} minutes` : `${seconds} seconds`;
}

export async function unlock(_prev: UnlockState, formData: FormData): Promise<UnlockState> {
  const h = await headers();
  const clientKey = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";

  const wait = retryAfterSeconds(clientKey);
  if (wait > 0) return { error: `Too many wrong attempts. Try again in ${formatWait(wait)}.` };

  const pin = formData.get("pin");
  if (typeof pin !== "string" || !pinMatches(pin.trim())) {
    recordFailure(clientKey);
    return { error: "Wrong PIN." };
  }

  const session = createSession();
  if (!session) {
    return { error: "The PIN lock needs SUPABASE_SERVICE_ROLE_KEY set on the server to sign your session." };
  }

  clearFailures(clientKey);
  (await cookies()).set(AUTH_COOKIE, session.value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: session.expires,
  });
  redirect(safeNextPath(formData.get("next")));
}

export async function lock() {
  (await cookies()).delete(AUTH_COOKIE);
  redirect("/lock");
}
