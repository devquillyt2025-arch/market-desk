"use client";

/**
 * Polls the world indices for the Watchlist's Global markets tab. The same failure handling as the global-prices strip
 * (useGlobalMarkets): an offline browser or a feed error is shown once rather than per request, and the levels already on
 * screen stay put through an outage instead of vanishing. They are also kept on this device, so after a restart the tab can
 * show the last levels it saw, labelled as old, rather than dashes.
 *
 * Unlike the strip this is not an app-wide poll: it runs only while `enabled` - the page switches it on for the tab that
 * shows these levels (Global markets) and off for the Indian markets. An index moves little
 * in a minute and the feed is about 15 minutes behind, so once a minute is plenty. A tick is skipped while the browser tab
 * is hidden or the previous request is still running; coming back to it refreshes at once.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { isWorldIndicesError, isWorldQuote, worldQuotesById, type WorldIndicesError, type WorldIndicesResult, type WorldQuote } from "@/lib/worldIndices";

export const WORLD_INDICES_POLL_MS = 60_000;

const STORAGE_KEY = "marketdesk:world-indices";

type Stored = { at: number; quotes: WorldQuote[] };

/** The last good levels saved on this device, or null - localStorage can be missing, full, or hold anything. */
function loadStored(storageKey: string): Stored | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const { at, quotes } = parsed as Partial<Stored>;
    if (typeof at !== "number" || !Array.isArray(quotes)) return null;
    const valid = quotes.filter(isWorldQuote);
    return valid.length > 0 ? { at, quotes: valid } : null;
  } catch {
    return null;
  }
}

function saveStored(storageKey: string, value: Stored): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // Storage may be unavailable or full; the levels just won't survive a reload.
  }
}

/** `ids`: just those indices (the ticker asks for what is ticked); every index when left out. */
async function fetchWorldIndices(ids?: readonly string[]): Promise<WorldIndicesResult | WorldIndicesError> {
  try {
    const url = ids ? `/api/world-indices?ids=${ids.map(encodeURIComponent).join(",")}` : "/api/world-indices";
    const res = await fetch(url, { cache: "no-store" });
    const body: unknown = await res.json();
    if (res.ok && body && typeof body === "object" && Array.isArray((body as WorldIndicesResult).quotes)) {
      const result = body as WorldIndicesResult;
      return { ...result, quotes: result.quotes.filter(isWorldQuote) };
    }
    const message = body && typeof body === "object" ? (body as Partial<WorldIndicesError>).error : undefined;
    return { error: message ?? `Request failed with status ${res.status}` };
  } catch {
    return { error: "network_error" };
  }
}

export type WorldIndicesState = {
  /** Latest quote per index id; empty until the first load (or a saved set) lands. */
  quotes: Record<string, WorldQuote>;
  /** The browser couldn't reach the app at all. */
  offline: boolean;
  /** The app answered but the price feed didn't - the message to show. */
  feedError: string | null;
  /** When `quotes` was fetched; while polling is failing, the age of the levels on screen (possibly an earlier session's). */
  lastPolledAt: number | null;
  /** The first request is still in flight and nothing is saved to show meanwhile. */
  loading: boolean;
  /** A refresh asked for by hand is in flight. */
  refreshing: boolean;
  refresh: () => Promise<void>;
};

export type WorldIndicesOptions = {
  /** Poll only these indices. Every index when left out; nothing is polled for an empty list. */
  ids?: readonly string[];
  /** Where the last good levels are kept on this device - a poll of a different set needs its own, or the two would overwrite each other. */
  storageKey?: string;
};

export function useWorldIndices(pollMs = WORLD_INDICES_POLL_MS, enabled = true, options: WorldIndicesOptions = {}): WorldIndicesState {
  const { ids, storageKey = STORAGE_KEY } = options;
  // Which indices are asked for, not the order or the array's identity (a fresh array every render would restart the poll each time).
  const idsKey = ids ? [...ids].sort().join(",") : null;
  const [quotes, setQuotes] = useState<Record<string, WorldQuote>>({});
  const [lastPolledAt, setLastPolledAt] = useState<number | null>(null);
  const [offline, setOffline] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const pollOnceRef = useRef<() => Promise<void>>(async () => {});
  // What is on screen, readable synchronously by the poll (its closure is made once, so state would be stale).
  const quotesRef = useRef<Record<string, WorldQuote>>({});

  useEffect(() => {
    if (!enabled || idsKey === "") return;
    const wanted = idsKey === null ? undefined : idsKey.split(",");
    let cancelled = false;
    let inFlight = 0;
    // Numbered so a slow older response can't land after, and overwrite, a newer one.
    let startedSeq = 0;
    let appliedSeq = 0;

    async function pollOnce() {
      const seq = ++startedSeq;
      inFlight++;
      const result = await fetchWorldIndices(wanted).finally(() => {
        inFlight--;
      });
      if (cancelled || seq < appliedSeq) return;
      appliedSeq = seq;
      setLoading(false);

      if (isWorldIndicesError(result)) {
        // Nothing on screen yet (a fresh page load while offline): fall back to what this device last saw.
        // Only on failure, so a normal load never flashes old levels.
        const saved = loadStored(storageKey);
        if (Object.keys(quotesRef.current).length === 0 && saved) {
          quotesRef.current = worldQuotesById(saved.quotes);
          setQuotes(quotesRef.current);
        }
        setLastPolledAt((prev) => prev ?? saved?.at ?? null);
        if (result.error === "network_error") {
          setOffline(true);
          setFeedError(null);
        } else {
          setFeedError(result.error);
          setOffline(false);
        }
        return;
      }

      // An index missing this time keeps the last level it had; the row says when that is from. Saved whole (the merged
      // set), so a partial answer doesn't erase what an earlier one had.
      quotesRef.current = { ...quotesRef.current, ...worldQuotesById(result.quotes) };
      setQuotes(quotesRef.current);
      setLastPolledAt(result.fetchedAt);
      setOffline(false);
      setFeedError(null);
      saveStored(storageKey, { at: result.fetchedAt, quotes: Object.values(quotesRef.current) });
    }

    const scheduled = () => {
      if (!document.hidden && inFlight === 0) void pollOnce();
    };

    pollOnceRef.current = pollOnce;
    void pollOnce();
    const interval = setInterval(scheduled, pollMs);
    document.addEventListener("visibilitychange", scheduled);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", scheduled);
    };
  }, [pollMs, enabled, idsKey, storageKey]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await pollOnceRef.current();
    } finally {
      setRefreshing(false);
    }
  }, []);

  return { quotes, offline, feedError, lastPolledAt, loading: loading && Object.keys(quotes).length === 0, refreshing, refresh };
}
