/**
 * Polls the planner's live data (see api/natgas-planner). Every 10 seconds while MCX trades and the tab is visible, every minute
 * once it is shut (nothing moves), at once when the timeframe or the contract changes. A failed poll keeps what is on screen; a lapsed Upstox token
 * is reported separately so the page can say what to do. The last answer is kept across mounts so revisiting the tab paints at once.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { Timeframe } from "@/lib/natgasPlanner/config";
import type { PlannerResult } from "@/lib/natgasPlannerFeed";

import type { ContractPref } from "./usePlannerPrefs";

const POLL_OPEN_MS = 10_000;
const POLL_SHUT_MS = 60_000;

type Answer = { ok: true; data: PlannerResult } | { ok: false; error: string; tokenExpired: boolean };

async function fetchPlanner(tf: Timeframe, contract: ContractPref): Promise<Answer> {
  try {
    const choice = contract === "default" ? "" : `&contract=${encodeURIComponent(contract)}`;
    const res = await fetch(`/api/natgas-planner?tf=${tf}${choice}`, { cache: "no-store" });
    const body: unknown = await res.json();
    if (res.ok && body && typeof body === "object" && Array.isArray((body as PlannerResult).timeframes)) return { ok: true, data: body as PlannerResult };
    const message = body && typeof body === "object" ? (body as { error?: string }).error : undefined;
    return { ok: false, error: message ?? `Request failed with status ${res.status}`, tokenExpired: message === "token_expired" };
  } catch {
    return { ok: false, error: "network_error", tokenExpired: false };
  }
}

/** The last answer for each choice of contract, so switching back (or reopening the tab) paints at once. */
const remembered = new Map<ContractPref, PlannerResult>();

export type PlannerState = {
  data: PlannerResult | null;
  tokenExpired: boolean;
  /** The last poll failed (the data on screen, if any, is the last good one). */
  failing: boolean;
  /** The data on screen is for another contract than the one asked for - the new one is still on the way. */
  contractPending: boolean;
  fetchedAt: number | null;
  refresh: () => void;
};

export function useNatgasPlanner(tf: Timeframe, contract: ContractPref, enabled = true): PlannerState {
  const [data, setData] = useState<PlannerResult | null>(() => remembered.get(contract) ?? null);
  const [answeredFor, setAnsweredFor] = useState<ContractPref | null>(() => (remembered.has(contract) ? contract : null));
  const [tokenExpired, setTokenExpired] = useState(false);
  const [failing, setFailing] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const marketOpen = useRef(true);
  const lastAsked = useRef<string | null>(null);
  const lastAt = useRef(0);
  const kick = useRef<(force: boolean) => void>(() => {});

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let inFlight = false;

    async function tick(force: boolean) {
      if (inFlight || document.hidden) return;
      const asking = `${tf}|${contract}`;
      const due = lastAsked.current !== asking || Date.now() - lastAt.current >= (marketOpen.current ? POLL_OPEN_MS : POLL_SHUT_MS) - 500;
      if (!force && !due) return;
      inFlight = true;
      try {
        const answer = await fetchPlanner(tf, contract);
        if (cancelled) return;
        lastAsked.current = asking;
        lastAt.current = Date.now();
        if (answer.ok) {
          remembered.set(contract, answer.data);
          marketOpen.current = answer.data.market.open;
          setData(answer.data);
          setAnsweredFor(contract);
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
  }, [enabled, tf, contract]);

  const refresh = useCallback(() => kick.current(true), []);
  return { data, tokenExpired, failing, contractPending: data !== null && answeredFor !== contract, fetchedAt, refresh };
}
