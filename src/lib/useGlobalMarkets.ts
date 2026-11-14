/**
 * Polls the global prices behind the strip across the top of every page. The same failure handling as the
 * Watchlist's quotes (useWatchlistQuotes): an offline browser or a feed error is shown once rather than per
 * request, and the prices already on screen stay put through an outage instead of vanishing. They are also kept on
 * this device, so after a restart the strip can show the last prices it saw, labelled as old, rather than dashes.
 *
 * A tick is skipped while the tab is hidden or the previous request is still running; coming back to the tab
 * refreshes at once. The strip sits in the root layout, so one poll runs for the whole session however many pages
 * are visited - and not at all while the PIN screen is up (the component mounts this only once unlocked).
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { isGlobalMarketsError, isGlobalQuote, quotesById, type GlobalMarketId, type GlobalMarketsError, type GlobalMarketsResult, type GlobalQuote } from "@/lib/globalMarkets";

/** The feed moves about once a minute and the server shares one fetch across tabs, so this is plenty. */
export const GLOBAL_MARKETS_POLL_MS = 20_000;

const STORAGE_KEY = "marketdesk:global-markets";

type Quotes = Partial<Record<GlobalMarketId, GlobalQuote>>;
type Stored = { at: number; quotes: GlobalQuote[] };

/** The last good prices saved on this device, or null - localStorage can be missing, full, or hold anything. */
function loadStored(): Stored | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const { at, quotes } = parsed as Partial<Stored>;
    if (typeof at !== "number" || !Array.isArray(quotes)) return null;
    const valid = quotes.filter(isGlobalQuote);
    return valid.length > 0 ? { at, quotes: valid } : null;
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

async function fetchGlobalMarkets(): Promise<GlobalMarketsResult | GlobalMarketsError> {
  try {
    const res = await fetch("/api/global-markets", { cache: "no-store" });
    const body: unknown = await res.json();
    if (res.ok && body && typeof body === "object" && Array.isArray((body as GlobalMarketsResult).quotes)) {
      const result = body as GlobalMarketsResult;
      return { ...result, quotes: result.quotes.filter(isGlobalQuote) };
    }
    const message = body && typeof body === "object" ? (body as Partial<GlobalMarketsError>).error : undefined;
    return { error: message ?? `Request failed with status ${res.status}` };
  } catch {
    return { error: "network_error" };
  }
}

export type GlobalMarketsState = {
  /** Latest quote per market; empty until the first load (or a saved set) lands. */
  quotes: Quotes;
  /** Markets the feed had no price for this time. */
  missing: ReadonlySet<GlobalMarketId>;
  /** The browser couldn't reach the app at all. */
  offline: boolean;
  /** The app answered but the price feed didn't - the message to show. */
  feedError: string | null;
  /** When `quotes` was fetched; while polling is failing, the age of the prices on screen (possibly an earlier session's). */
  lastPolledAt: number | null;
  /** The first request is still in flight and nothing is saved to show meanwhile. */
  loading: boolean;
  /** A refresh asked for by hand is in flight. */
  refreshing: boolean;
  refresh: () => Promise<void>;
};

/** `enabled` false (the PIN screen) polls nothing: the API would only answer 401, and nothing should load until unlocked. */
export function useGlobalMarkets(pollMs = GLOBAL_MARKETS_POLL_MS, enabled = true): GlobalMarketsState {
  const [quotes, setQuotes] = useState<Quotes>({});
  const [missing, setMissing] = useState<ReadonlySet<GlobalMarketId>>(new Set());
  const [lastPolledAt, setLastPolledAt] = useState<number | null>(null);
  const [offline, setOffline] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const pollOnceRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let inFlight = 0;
    // Numbered so a slow older response can't land after, and overwrite, a newer one.
    let startedSeq = 0;
    let appliedSeq = 0;

    async function pollOnce() {
      const seq = ++startedSeq;
      inFlight++;
      const result = await fetchGlobalMarkets().finally(() => {
        inFlight--;
      });
      if (cancelled || seq < appliedSeq) return;
      appliedSeq = seq;
      setLoading(false);

      if (isGlobalMarketsError(result)) {
        // Nothing on screen yet (a fresh page load while offline): fall back to what this device last saw.
        // Only on failure, so a normal load never flashes old prices.
        const saved = loadStored();
        setQuotes((prev) => (Object.keys(prev).length > 0 || !saved ? prev : quotesById(saved.quotes)));
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

      // A market missing this time keeps the last price it had; the strip dims it once it is old enough.
      setQuotes((prev) => ({ ...prev, ...quotesById(result.quotes) }));
      setMissing(new Set(result.missing));
      setLastPolledAt(result.fetchedAt);
      setOffline(false);
      setFeedError(null);
      saveStored({ at: result.fetchedAt, quotes: result.quotes });
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
  }, [pollMs, enabled]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await pollOnceRef.current();
    } finally {
      setRefreshing(false);
    }
  }, []);

  return { quotes, missing, offline, feedError, lastPolledAt, loading: loading && Object.keys(quotes).length === 0, refreshing, refresh };
}
