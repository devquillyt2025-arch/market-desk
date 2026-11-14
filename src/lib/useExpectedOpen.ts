/**
 * Polls where MCX natural gas and crude oil are expected to open (see expectedOpen.ts). Shared by the Watchlist's Global
 * markets section and the Live Portfolio, so it lives here rather than in either.
 *
 * Every 30 seconds while the tab is visible - the NYMEX price it leans on only moves about once a minute, and the server
 * shares one fetch between polls anyway. While MCX is trading the server answers `open: true` at once and the panels show
 * nothing, so the poll costs next to nothing by day and picks up the evening's close by itself.
 *
 * A failed poll keeps what is on screen once; a second failure in a row takes it away, so a figure that has gone stale
 * (MCX may have reopened since) is never left standing.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { isExpectedOpenError, type ExpectedOpenError, type ExpectedOpenResult } from "@/lib/expectedOpen";

export const EXPECTED_OPEN_POLL_MS = 30_000;

async function fetchExpectedOpen(): Promise<ExpectedOpenResult | ExpectedOpenError> {
  try {
    const res = await fetch("/api/expected-open", { cache: "no-store" });
    const body: unknown = await res.json();
    if (res.ok && body && typeof body === "object" && Array.isArray((body as ExpectedOpenResult).items)) return body as ExpectedOpenResult;
    const message = body && typeof body === "object" ? (body as Partial<ExpectedOpenError>).error : undefined;
    return { error: message ?? `Request failed with status ${res.status}` };
  } catch {
    return { error: "network_error" };
  }
}

/**
 * The last answer, kept across mounts: the Watchlist builds its Global markets tab only while it is open, and without this
 * the panel would appear a moment after the tab does and push the prices sideways. The first poll replaces it at once.
 */
let remembered: ExpectedOpenResult | null = null;

export type ExpectedOpenState = {
  /** The latest answer; null until the first one lands, or after repeated failures. */
  result: ExpectedOpenResult | null;
  /** The Upstox token has lapsed, so MCX's last price can't be read - the Live Portfolio and Watchlist banners already say so. */
  tokenExpired: boolean;
  lastPolledAt: number | null;
};

export function useExpectedOpen(enabled = true, pollMs = EXPECTED_OPEN_POLL_MS): ExpectedOpenState {
  const [result, setResult] = useState<ExpectedOpenResult | null>(() => remembered);
  const [tokenExpired, setTokenExpired] = useState(false);
  const [lastPolledAt, setLastPolledAt] = useState<number | null>(null);
  const failures = useRef(0);

  const poll = useCallback(async (isCancelled: () => boolean) => {
    const answer = await fetchExpectedOpen();
    if (isCancelled()) return;
    if (isExpectedOpenError(answer)) {
      failures.current += 1;
      setTokenExpired(answer.error === "token_expired");
      if (failures.current >= 2 || answer.error === "token_expired") {
        remembered = null;
        setResult(null);
      }
      return;
    }
    failures.current = 0;
    setTokenExpired(false);
    remembered = answer;
    setResult(answer);
    setLastPolledAt(answer.fetchedAt);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let inFlight = false;
    const isCancelled = () => cancelled;

    async function tick() {
      if (inFlight || document.hidden) return;
      inFlight = true;
      try {
        await poll(isCancelled);
      } finally {
        inFlight = false;
      }
    }

    void tick();
    const interval = setInterval(() => void tick(), pollMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [enabled, pollMs, poll]);

  return { result, tokenExpired, lastPolledAt };
}
