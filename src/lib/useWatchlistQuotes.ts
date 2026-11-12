/**
 * Polls live quotes for the Watchlist. Mirrors useHeatmap's failure handling - token-expired and offline are
 * surfaced once (through the shared LivePricingBanners) rather than per request, scheduled polling stops on a known-bad
 * token until a fresh attempt proves it fixed, and the prices already on screen stay put through an outage
 * instead of vanishing. They are also kept on this device, so the morning after the daily token lapses the
 * list still shows yesterday's close, labelled as such, rather than a wall of dashes.
 *
 * One request covers the whole list. A tick is skipped while the tab is hidden or the previous request is still
 * running; coming back to the tab refreshes at once.
 */

import { useEffect, useRef, useState } from "react";

import { showToast } from "@/lib/toast";
import { fetchWatchlistQuotes } from "@/lib/upstox/client";
import { isUpstoxWatchlistError } from "@/lib/upstox/types";
import type { WatchQuote, WatchlistItem } from "@/lib/watchlist";

export const WATCHLIST_POLL_MS = 5000;

const STORAGE_KEY = "marketdesk:watchlist-quotes";

type Stored = { at: number; quotes: Record<string, WatchQuote> };

/** The last good quotes saved on this device, or null - localStorage can be missing, full, or hold anything. */
function loadStored(): Stored | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const { at, quotes } = parsed as Partial<Stored>;
    return typeof at === "number" && quotes && typeof quotes === "object" ? { at, quotes } : null;
  } catch {
    return null;
  }
}

function saveStored(value: Stored): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Storage may be unavailable or full; the prices just won't survive a reload.
  }
}

export type WatchlistQuotesState = {
  /** Latest quote per `itemKey`; empty until the first load (or a saved set) lands. */
  quotes: Record<string, WatchQuote>;
  /** Instruments Upstox had no price for this time. */
  missing: ReadonlySet<string>;
  tokenExpired: boolean;
  offline: boolean;
  /** A failure that is neither of the above (an Upstox 5xx) - the message to show. */
  loadError: string | null;
  /** When `quotes` was fetched; while polling is failing, the age of the prices on screen (possibly an earlier session's). */
  lastPolledAt: number | null;
  /** The first request is still in flight and nothing is saved to show meanwhile. */
  loading: boolean;
  manualRefreshing: boolean;
  refresh: () => Promise<void>;
};

export function useWatchlistQuotes(items: WatchlistItem[] | null, pollMs = WATCHLIST_POLL_MS): WatchlistQuotesState {
  const [quotes, setQuotes] = useState<Record<string, WatchQuote>>({});
  const [missing, setMissing] = useState<ReadonlySet<string>>(new Set());
  const [lastPolledAt, setLastPolledAt] = useState<number | null>(null);
  const [tokenExpired, setTokenExpired] = useState(false);
  const [offline, setOffline] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  // Read by the poll loop synchronously: its closure only changes with the list, so a state read would be stale across ticks.
  const tokenExpiredRef = useRef(false);
  const pollOnceRef = useRef<(force?: boolean) => Promise<void>>(async () => {});

  // What the poll depends on is *which* instruments are on the list, not their order or names.
  const listKey = items ? [...items.map((item) => item.itemKey)].sort().join(",") : null;

  useEffect(() => {
    if (!items || items.length === 0) return;
    const requested = items.map(({ itemKey, kind, symbol }) => ({ itemKey, kind, symbol }));
    let cancelled = false;
    let inFlight = 0;
    // Numbered so a slow older response can't land after, and overwrite, a newer one.
    let startedSeq = 0;
    let appliedSeq = 0;

    async function pollOnce(force = false) {
      if (tokenExpiredRef.current && !force) return;
      const seq = ++startedSeq;
      inFlight++;
      const result = await fetchWatchlistQuotes(requested).finally(() => {
        inFlight--;
      });
      if (cancelled || seq < appliedSeq) return;
      appliedSeq = seq;
      setLoading(false);

      if (isUpstoxWatchlistError(result)) {
        // Nothing on screen yet (a fresh page load, the morning after the token lapsed): fall back to what this
        // device last saw, so there is still something to show. Only on failure, so a normal load never flashes it.
        const saved = loadStored();
        setQuotes((prev) => (Object.keys(prev).length > 0 || !saved ? prev : saved.quotes));
        setLastPolledAt((prev) => prev ?? saved?.at ?? null);
        if (result.error === "token_expired") {
          // No toast: LivePricingBanners already shows this persistently.
          tokenExpiredRef.current = true;
          setTokenExpired(true);
          setOffline(false);
          setLoadError(null);
        } else if (result.error === "network_error") {
          setOffline(true);
          setLoadError(null);
        } else {
          setLoadError(result.error);
          setOffline(false);
        }
        return;
      }

      const at = Date.now();
      setQuotes(result.quotes);
      setMissing(new Set(result.missing));
      setLastPolledAt(at);
      saveStored({ at, quotes: result.quotes });
      setOffline(false);
      setLoadError(null);
      if (tokenExpiredRef.current) {
        tokenExpiredRef.current = false;
        setTokenExpired(false);
        showToast("Upstox token accepted - live pricing resumed.", "success");
      }
    }

    const scheduled = () => {
      if (!document.hidden && inFlight === 0) void pollOnce();
    };
    const onVisible = () => {
      if (!document.hidden && inFlight === 0) void pollOnce();
    };

    pollOnceRef.current = pollOnce;
    void pollOnce(true);
    const interval = setInterval(scheduled, pollMs);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // listKey is the list's identity; `items` is a fresh array every render and would restart the poll each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey, pollMs]);

  async function refresh() {
    setManualRefreshing(true);
    try {
      await pollOnceRef.current(true);
    } finally {
      setManualRefreshing(false);
    }
  }

  return { quotes, missing, tokenExpired, offline, loadError, lastPolledAt, loading: loading && Object.keys(quotes).length === 0, manualRefreshing, refresh };
}
