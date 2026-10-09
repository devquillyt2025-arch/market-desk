/**
 * PIN lock shared by proxy.ts (checks the cookie on every request) and the
 * /lock server actions (check the PIN, issue and clear the cookie).
 *
 * Server-only: it reads SUPABASE_SERVICE_ROLE_KEY as the cookie-signing key,
 * so never import it from a "use client" component.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const AUTH_COOKIE = "marketdesk_auth";
export const SESSION_DAYS = 30;

/** Used when APP_PIN isn't set. Set APP_PIN in the environment to change the PIN without touching code. */
const DEFAULT_PIN = "2026";

/** Where to land after unlocking when the visitor didn't come from a specific page. */
const DEFAULT_LANDING = "/portfolio";

const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

function getPin(): string {
  return process.env.APP_PIN?.trim() || DEFAULT_PIN;
}

/**
 * The PIN is part of the signed message, so changing it signs everyone out.
 * Null when the signing key is missing — callers treat that as "locked, and
 * nobody can unlock" rather than silently accepting an unsigned cookie.
 */
function sign(expires: string): string | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createHmac("sha256", key).update(`marketdesk-pin-session:${expires}:${getPin()}`).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function pinMatches(input: string): boolean {
  // Hash both sides so the comparison is constant-length whatever was typed.
  const digest = (s: string) => createHash("sha256").update(s).digest("hex");
  return safeEqual(digest(input), digest(getPin()));
}

/** A signed, expiring cookie value — "<expiresAtMs>.<hmac>". Null when the signing key isn't configured. */
export function createSession(): { value: string; expires: Date } | null {
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const mac = sign(String(expires.getTime()));
  return mac ? { value: `${expires.getTime()}.${mac}`, expires } : null;
}

export function verifySession(token: string | undefined): boolean {
  if (!token) return false;
  const [expires, mac] = token.split(".");
  if (!expires || !mac || !/^\d+$/.test(expires) || Number(expires) < Date.now()) return false;
  const expected = sign(expires);
  return expected !== null && safeEqual(mac, expected);
}

/** Only same-site paths are honoured as a post-unlock destination, so /lock?next= can't be used as an open redirect. */
export function safeNextPath(next: unknown): string {
  if (typeof next !== "string") return DEFAULT_LANDING;
  const ok = next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") && !next.startsWith("/lock");
  return ok ? next : DEFAULT_LANDING;
}

// Wrong-PIN throttle: 5 misses per client per 15 minutes. In-memory, so it's
// per server instance and resets on a restart, hot reload or cold start — a
// speed bump against guessing the 10,000 four-digit PINs, not a hard guarantee.
const failures = new Map<string, { count: number; resetAt: number }>();

/** Seconds until `key` may try again — 0 when it can try now. */
export function retryAfterSeconds(key: string): number {
  const entry = failures.get(key);
  if (!entry) return 0;
  const remaining = entry.resetAt - Date.now();
  if (remaining <= 0) {
    failures.delete(key);
    return 0;
  }
  return entry.count >= MAX_FAILURES ? Math.ceil(remaining / 1000) : 0;
}

export function recordFailure(key: string): void {
  const now = Date.now();
  if (failures.size > 500) {
    for (const [k, v] of failures) if (v.resetAt <= now) failures.delete(k);
  }
  const entry = failures.get(key);
  if (!entry || entry.resetAt <= now) failures.set(key, { count: 1, resetAt: now + FAILURE_WINDOW_MS });
  else entry.count += 1;
}

export function clearFailures(key: string): void {
  failures.delete(key);
}
