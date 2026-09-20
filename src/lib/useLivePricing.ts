/**
 * Shared polling engine behind every "open positions, priced live" table —
 * Live Portfolio and Paper Trade both want the exact same behavior (fetch
 * each distinct instrument+expiry group's option chain, compute a row per
 * entry, surface token-expired/offline once instead of per group, retry on
 * an interval). Pulled out of PortfolioView once Paper Trade needed the
 * identical logic a second time, rather than kept duplicated.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import {
  computePortfolioRow,
  isTrackableEntry,
  portfolioGroupKey,
  type PortfolioRow,
} from "@/lib/calculatePortfolio";
import { showToast } from "@/lib/toast";
import type { TradeEntry } from "@/lib/types";
import { fetchOptionChain } from "@/lib/upstox/client";
import { isUpstoxOptionChainError, type UpstoxOptionChainResult } from "@/lib/upstox/types";

const DEFAULT_POLL_MS = 10000;

export type LivePricingState = {
  rows: PortfolioRow[] | null;
  tokenExpired: boolean;
  offline: boolean;
  lastPolledAt: number | null;
  manualRefreshing: boolean;
  /** Number of distinct instrument+expiry groups being polled — 0 means the refresh button has nothing to do. */
  groupCount: number;
  handleManualRefresh: () => Promise<void>;
};

/** `openEntries` should already be filtered to whichever entries this table considers "still open". */
export function useLivePricing(openEntries: TradeEntry[] | null, pollMs = DEFAULT_POLL_MS): LivePricingState {
  const [chainsByGroup, setChainsByGroup] = useState<Record<string, UpstoxOptionChainResult | undefined>>({});
  const [tokenExpired, setTokenExpired] = useState(false);
  const [offline, setOffline] = useState(false);
  const [lastPolledAt, setLastPolledAt] = useState<number | null>(null);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  // Mirrors `tokenExpired` for the poll loop to read synchronously — the
  // loop's own closure is only recreated when `groupKeysDep` changes, so it
  // would otherwise see a stale value across ticks within that window.
  const tokenExpiredRef = useRef(false);
  // Same idea for `offline`, but unlike tokenExpiredRef this one doesn't
  // gate future polls — a dropped connection can come back on its own, so
  // polling keeps retrying every tick instead of stopping until a manual fix.
  const offlineRef = useRef(false);
  // Lets the manual refresh button call the *current* poll closure (which
  // captures this render's groupKeys) without waiting for the next
  // scheduled tick, and without duplicating the polling logic.
  const pollOnceRef = useRef<(force?: boolean) => Promise<void>>(async () => {});

  const groupKeys = useMemo(() => {
    if (!openEntries) return [];
    const set = new Set(
      openEntries.filter(isTrackableEntry).map((e) => portfolioGroupKey(e.instrument, e.expiry_date)),
    );
    return [...set].sort();
  }, [openEntries]);
  const groupKeysDep = groupKeys.join(",");

  useEffect(() => {
    if (groupKeys.length === 0) return;
    let cancelled = false;

    async function pollOnce(force = false) {
      // The scheduled interval respects a known-bad token (no point
      // re-hitting Upstox every tick with a token we already know fails);
      // a manual refresh always goes through, since a fresh click is the
      // user telling us they think something changed (e.g. they just saved
      // a new token at /settings).
      if (tokenExpiredRef.current && !force) return;

      const results = await Promise.all(
        groupKeys.map(async (key) => {
          const [instrument, expiry] = key.split("|");
          try {
            const data = await fetchOptionChain(instrument as TradeEntry["instrument"], expiry);
            return [key, data] as const;
          } catch {
            // fetch() itself rejecting (as opposed to resolving with a non-ok
            // status, which the route always turns into a normal { error }
            // body) means the request never reached the server at all — a
            // dropped connection, not anything Upstox- or app-specific.
            return [key, { error: "network_error" }] as const;
          }
        }),
      );
      if (cancelled) return;

      const next: Record<string, UpstoxOptionChainResult> = {};
      let anyTokenExpired = false;
      let anyNetworkError = false;
      for (const [key, data] of results) {
        next[key] = data;
        if (isUpstoxOptionChainError(data)) {
          if (data.error === "token_expired") anyTokenExpired = true;
          if (data.error === "network_error") anyNetworkError = true;
        }
      }
      setChainsByGroup(next);
      setLastPolledAt(Date.now());

      if (anyTokenExpired && !tokenExpiredRef.current) {
        // No showToast here — LivePricingBanners already renders this
        // persistently as long as tokenExpired stays true, and stacking a
        // transient toast on top of it just duplicates the message while
        // temporarily covering real content on short (mobile) viewports.
        tokenExpiredRef.current = true;
        setTokenExpired(true);
      } else if (!anyTokenExpired && tokenExpiredRef.current) {
        // Only reachable via a forced (manual) poll, since the interval
        // stops attempting once expired — a successful forced retry means
        // the token was fixed, so let scheduled polling resume too.
        tokenExpiredRef.current = false;
        setTokenExpired(false);
        showToast("Upstox token accepted — live pricing resumed.", "success");
      }

      if (anyNetworkError && !offlineRef.current) {
        // Same reasoning as the token-expired branch above — LivePricingBanners
        // already covers this state persistently.
        offlineRef.current = true;
        setOffline(true);
      } else if (!anyNetworkError && offlineRef.current) {
        offlineRef.current = false;
        setOffline(false);
      }
    }

    pollOnceRef.current = pollOnce;
    pollOnce();
    const interval = setInterval(() => pollOnce(), pollMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- groupKeys is derived fresh each render; groupKeysDep is its stable identity for this effect.
  }, [groupKeysDep, pollMs]);

  async function handleManualRefresh() {
    setManualRefreshing(true);
    try {
      await pollOnceRef.current(true);
    } finally {
      setManualRefreshing(false);
    }
  }

  const rows: PortfolioRow[] | null = useMemo(
    () => (openEntries ? openEntries.map((entry) => computePortfolioRow(entry, chainsByGroup)) : null),
    [openEntries, chainsByGroup],
  );

  return {
    rows,
    tokenExpired,
    offline,
    lastPolledAt,
    manualRefreshing,
    groupCount: groupKeys.length,
    handleManualRefresh,
  };
}
