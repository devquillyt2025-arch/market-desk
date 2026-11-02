/**
 * Keeps Live Portfolio in step with the Upstox account: fetches the open
 * positions on an interval (Upstox itself only refreshes them about once a
 * minute) and writes any difference to live_portfolio_entries, which the page
 * then reads like any other table — Realtime brings the change back. Like
 * useLivePricing, an expired token stops the scheduled retries until a manual
 * sync.
 */

import { useEffect, useRef, useState } from "react";

import { syncLivePortfolioWithUpstox } from "@/lib/livePortfolioEntriesStore";
import { fetchPositions } from "@/lib/upstox/client";
import { isUpstoxPositionsError, type UpstoxPosition } from "@/lib/upstox/types";

const DEFAULT_POLL_MS = 60000;

/** yyyy-mm-dd in the device's own timezone — matches how entry_date is entered everywhere else. */
function localISODate(ms: number): string {
  const d = new Date(ms);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export type UpstoxPositionsState = {
  /** The latest positions Upstox reported, squared-off-today ones included — null until the first successful sync. */
  positions: UpstoxPosition[] | null;
  /** Upstox positions left out for being in something other than the three indices' options. */
  otherCount: number;
  syncedAt: number | null;
  tokenExpired: boolean;
  offline: boolean;
  /** Any other failure (Upstox erroring, the write to the table failing), worded for display. */
  error: string | null;
  manualSyncing: boolean;
  syncNow: () => Promise<void>;
};

export function useUpstoxPositions(pollMs = DEFAULT_POLL_MS): UpstoxPositionsState {
  const [positions, setPositions] = useState<UpstoxPosition[] | null>(null);
  const [otherCount, setOtherCount] = useState(0);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [tokenExpired, setTokenExpired] = useState(false);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualSyncing, setManualSyncing] = useState(false);
  // Read by the interval synchronously — same reason as useLivePricing's tokenExpiredRef.
  const tokenExpiredRef = useRef(false);
  // Lets the manual sync call the effect's own sync function, same as useLivePricing's pollOnceRef.
  const syncOnceRef = useRef<(force?: boolean) => Promise<void>>(async () => {});

  useEffect(() => {
    let cancelled = false;

    async function syncOnce(force = false) {
      if (tokenExpiredRef.current && !force) return;

      const result = await fetchPositions();
      if (cancelled) return;
      if (isUpstoxPositionsError(result)) {
        tokenExpiredRef.current = result.error === "token_expired";
        setTokenExpired(result.error === "token_expired");
        setOffline(result.error === "network_error");
        setError(result.error === "token_expired" || result.error === "network_error" ? null : result.error);
        return;
      }
      tokenExpiredRef.current = false;
      setTokenExpired(false);
      setOffline(false);

      const now = Date.now();
      try {
        await syncLivePortfolioWithUpstox(result.positions, localISODate(now));
        setError(null);
      } catch {
        setError("couldn't save the synced positions.");
      }
      setPositions(result.positions);
      setOtherCount(result.otherCount);
      setSyncedAt(now);
    }

    syncOnceRef.current = syncOnce;
    syncOnce();
    const interval = setInterval(() => syncOnce(), pollMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pollMs]);

  async function syncNow() {
    setManualSyncing(true);
    try {
      await syncOnceRef.current(true);
    } finally {
      setManualSyncing(false);
    }
  }

  return { positions, otherCount, syncedAt, tokenExpired, offline, error, manualSyncing, syncNow };
}
