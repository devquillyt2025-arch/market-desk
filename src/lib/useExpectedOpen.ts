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
 *
 * The Natural gas tab asks for a natural gas future of the user's choosing (`contract`); the others ask for none and get the front
 * month. Each choice is kept on its own, and while another choice's answer is on its way the old one stays up, marked `pending`.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { isExpectedOpenError, type ExpectedOpenError, type ExpectedOpenResult } from "@/lib/expectedOpen";
import type { ContractPref } from "@/lib/natgasContract";

export const EXPECTED_OPEN_POLL_MS = 30_000;

async function fetchExpectedOpen(contract: ContractPref | null): Promise<ExpectedOpenResult | ExpectedOpenError> {
  try {
    const res = await fetch(contract === null ? "/api/expected-open" : `/api/expected-open?contract=${encodeURIComponent(contract)}`, { cache: "no-store" });
    const body: unknown = await res.json();
    if (res.ok && body && typeof body === "object" && Array.isArray((body as ExpectedOpenResult).items)) return body as ExpectedOpenResult;
    const message = body && typeof body === "object" ? (body as Partial<ExpectedOpenError>).error : undefined;
    return { error: message ?? `Request failed with status ${res.status}` };
  } catch {
    return { error: "network_error" };
  }
}

/**
 * The last answer for each choice of contract ("" for none), kept across mounts: the Watchlist builds its Global markets tab only
 * while it is open, and without this the panel would appear a moment after the tab does and push the prices sideways. The first
 * poll replaces it at once.
 */
const remembered = new Map<string, ExpectedOpenResult>();

export type ExpectedOpenState = {
  /** The latest answer; null until the first one lands, or after repeated failures. */
  result: ExpectedOpenResult | null;
  /** The Upstox token has lapsed, so MCX's last price can't be read - the Live Portfolio and Watchlist banners already say so. */
  tokenExpired: boolean;
  lastPolledAt: number | null;
  /** The answer on screen is for another choice of contract than the one asked for: the new one is still on its way. */
  pending: boolean;
};

export function useExpectedOpen(enabled = true, pollMs = EXPECTED_OPEN_POLL_MS, contract: ContractPref | null = null): ExpectedOpenState {
  const asked = contract ?? "";
  const [answer, setAnswer] = useState<{ asked: string; result: ExpectedOpenResult } | null>(() => {
    const held = remembered.get(asked);
    return held ? { asked, result: held } : null;
  });
  const [tokenExpired, setTokenExpired] = useState(false);
  const [lastPolledAt, setLastPolledAt] = useState<number | null>(null);
  const failures = useRef(0);

  const poll = useCallback(
    async (isCancelled: () => boolean) => {
      const key = contract ?? "";
      const latest = await fetchExpectedOpen(contract);
      if (isCancelled()) return;
      if (isExpectedOpenError(latest)) {
        failures.current += 1;
        setTokenExpired(latest.error === "token_expired");
        if (failures.current >= 2 || latest.error === "token_expired") {
          remembered.delete(key);
          setAnswer(null);
        }
        return;
      }
      failures.current = 0;
      setTokenExpired(false);
      remembered.set(key, latest);
      setAnswer({ asked: key, result: latest });
      setLastPolledAt(latest.fetchedAt);
    },
    [contract],
  );

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

  return { result: answer?.result ?? null, tokenExpired, lastPolledAt, pending: answer !== null && answer.asked !== asked };
}
