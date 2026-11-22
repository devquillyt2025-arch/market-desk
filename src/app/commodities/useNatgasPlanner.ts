/**
 * Polls the planner's live data (see api/natgas-planner). Every 10 seconds while MCX trades and the tab is visible, every minute
 * once it is shut (nothing moves), at once when the timeframe changes. A failed poll keeps what is on screen; a lapsed Upstox token
 * is reported separately so the page can say what to do. The last answer is kept across mounts so revisiting the tab paints at once.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { Timeframe } from "@/lib/natgasPlanner/config";
import type { PlannerResult } from "@/lib/natgasPlannerFeed";

const POLL_OPEN_MS = 10_000;
const POLL_SHUT_MS = 60_000;

type Answer = { ok: true; data: PlannerResult } | { ok: false; error: string; tokenExpired: boolean };

async function fetchPlanner(tf: Timeframe): Promise<Answer> {
  try {
    const res = await fetch(`/api/natgas-planner?tf=${tf}`, { cache: "no-store" });
    const body: unknown = await res.json();
    if (res.ok && body && typeof body === "object" && Array.isArray((body as PlannerResult).timeframes)) return { ok: true, data: body as PlannerResult };
    const message = body && typeof body === "object" ? (body as { error?: string }).error : undefined;
    return { ok: false, error: message ?? `Request failed with status ${res.status}`, tokenExpired: message === "token_expired" };
  } catch {
    return { ok: false, error: "network_error", tokenExpired: false };
  }
}

let remembered: PlannerResult | null = null;

export type PlannerState = {
  data: PlannerResult | null;
  tokenExpired: boolean;
  /** The last poll failed (the data on screen, if any, is the last good one). */
  failing: boolean;
  /** The data on screen is not yet for the selected timeframe - its chart is still on the way. */
  chartPending: boolean;
  fetchedAt: number | null;
  refresh: () => void;
};

export function useNatgasPlanner(tf: Timeframe, enabled = true): PlannerState {
  const [data, setData] = useState<PlannerResult | null>(() => remembered);
  const [tokenExpired, setTokenExpired] = useState(false);
  const [failing, setFailing] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const marketOpen = useRef(true);
  const lastTf = useRef<Timeframe | null>(null);
  const lastAt = useRef(0);
  const kick = useRef<(force: boolean) => void>(() => {});

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let inFlight = false;

    async function tick(force: boolean) {
      if (inFlight || document.hidden) return;
      const due = lastTf.current !== tf || Date.now() - lastAt.current >= (marketOpen.current ? POLL_OPEN_MS : POLL_SHUT_MS) - 500;
      if (!force && !due) return;
      inFlight = true;
      try {
        const answer = await fetchPlanner(tf);
        if (cancelled) return;
        lastTf.current = tf;
        lastAt.current = Date.now();
        if (answer.ok) {
          remembered = answer.data;
          marketOpen.current = answer.data.market.open;
          setData(answer.data);
          setTokenExpired(false);
          setFailing(false);
          setFetchedAt(answer.data.asOf);
        } else {
          setTokenExpired(answer.tokenExpired);
          setFailing(!answer.tokenExpired);
        }
      } finally {
        inFlight = false;
      }
    }

    kick.current = (force) => void tick(force);
    void tick(true);
    const interval = setInterval(() => void tick(false), POLL_OPEN_MS);
    const onVisible = () => void tick(false);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, tf]);

  const refresh = useCallback(() => kick.current(true), []);
  return { data, tokenExpired, failing, chartPending: data !== null && data.selected.tf !== tf, fetchedAt, refresh };
}
