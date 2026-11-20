"use client";

/**
 * Loads Upstox's P&L report for Reports - every row of the last three financial years, as trades. Not live: the report is
 * built overnight, so it is read when the page opens and again on a refresh by hand, not polled.
 *
 * The last good copy is kept on this device (see reportCache.ts), shown at once while the fresh one loads and kept on screen
 * through a failure - an expired token, being offline - with `error` saying why it is old, rather than the page going blank.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { fetchPnlCharges, fetchPnlTrades } from "@/lib/upstox/client";
import { parseStoredReport, REPORT_CACHE_KEY } from "@/lib/upstox/reportCache";
import {
  isUpstoxPnlChargesError,
  isUpstoxPnlTradesError,
  type UpstoxChargesBreakdown,
  type UpstoxReportTrade,
  type UpstoxSummaryScope,
} from "@/lib/upstox/types";

export type UpstoxReportState = {
  /** Null until there is anything to show: no saved copy and the first load hasn't finished. */
  trades: UpstoxReportTrade[] | null;
  /** When `trades` was fetched - an earlier session's, while it is a saved copy. */
  fetchedAt: number | null;
  /** The first load is still in flight and there is no saved copy to show meanwhile. */
  loading: boolean;
  /** "token_expired", "network_error" or Upstox's own message - set while `trades` are an old copy (or absent). */
  error: string | null;
  refreshing: boolean;
  refresh: () => Promise<void>;
};

export function useUpstoxReport(): UpstoxReportState {
  const [trades, setTrades] = useState<UpstoxReportTrade[] | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const tradesRef = useRef<UpstoxReportTrade[] | null>(null);

  const load = useCallback(async () => {
    const result = await fetchPnlTrades();
    setLoading(false);
    if (isUpstoxPnlTradesError(result)) {
      // Nothing on screen yet: fall back to what this device last saw. Only on failure, so a normal load never flashes an old copy.
      if (tradesRef.current === null) {
        try {
          const saved = parseStoredReport(localStorage.getItem(REPORT_CACHE_KEY));
          if (saved) {
            tradesRef.current = saved.trades;
            setTrades(saved.trades);
            setFetchedAt(saved.fetchedAt);
          }
        } catch {
          // Storage unavailable: there is just no old copy to fall back to.
        }
      }
      setError(result.error);
      return;
    }
    tradesRef.current = result.trades;
    setTrades(result.trades);
    setFetchedAt(result.fetchedAt);
    setError(null);
    try {
      localStorage.setItem(REPORT_CACHE_KEY, JSON.stringify({ fetchedAt: result.fetchedAt, trades: result.trades }));
    } catch {
      // Storage may be full; the report just won't survive a reload without Upstox.
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  return { trades, fetchedAt, loading: loading && trades === null, error, refreshing, refresh };
}

export type PnlChargesState = {
  /** Null while loading, and after a failure. */
  charges: UpstoxChargesBreakdown | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
};

/**
 * Upstox's charges for a scope and window - what takes gross P&L to net. Refetched whenever the scope or the window changes;
 * `enabled` holds it back (until there is a report to take the charges of).
 */
export function usePnlCharges(scope: UpstoxSummaryScope, from: string, to: string, enabled: boolean): PnlChargesState {
  const [attempt, setAttempt] = useState(0);
  const key = `${scope}|${from}|${to}|${attempt}`;
  // Keyed by what was asked for, so a change shows as loading without resetting state inside the effect.
  const [loaded, setLoaded] = useState<{ key: string; charges: UpstoxChargesBreakdown | null; error: string | null } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void fetchPnlCharges(scope, from, to).then((result) => {
      if (cancelled) return;
      setLoaded(isUpstoxPnlChargesError(result) ? { key, charges: null, error: result.error } : { key, charges: result.charges, error: null });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, scope, from, to, key]);

  const current = enabled && loaded?.key === key ? loaded : null;
  return { charges: current?.charges ?? null, loading: enabled && current === null, error: current?.error ?? null, retry: () => setAttempt((n) => n + 1) };
}
