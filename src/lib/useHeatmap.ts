/**
 * Polls one index + range's constituents for the Heatmap tab. Mirrors
 * useLivePricing's failure handling — token-expired and offline are surfaced
 * once (through the shared LivePricingBanners) rather than per request, and
 * scheduled polling stops on a known-bad token until a fresh attempt proves
 * it's been fixed.
 *
 * Only the *active* index + range is polled, but every combination's last
 * good result is kept, so flipping back to one paints instantly instead of
 * re-showing a spinner.
 */

import { useEffect, useRef, useState } from "react";

import type { HeatmapRange } from "@/lib/heatmap/ranges";
import { showToast } from "@/lib/toast";
import type { Instrument } from "@/lib/types";
import { fetchHeatmap } from "@/lib/upstox/client";
import { isUpstoxHeatmapError, type HeatmapQuote, type IndexQuote, type UpstoxHeatmapResult } from "@/lib/upstox/types";

export const HEATMAP_POLL_MS = 10000;

export type HeatmapState = {
  /** The active index + range's latest quotes — null until its first successful load. */
  quotes: HeatmapQuote[] | null;
  /** The three headline indices over the same range — null until the first successful load. */
  indices: IndexQuote[] | null;
  tokenExpired: boolean;
  offline: boolean;
  /** A failure that's neither of the above (e.g. Upstox returned a 5xx) — the message to show. */
  loadError: string | null;
  /** When the active index + range last loaded successfully — null until it has. */
  lastPolledAt: number | null;
  manualRefreshing: boolean;
  handleManualRefresh: () => Promise<void>;
};

type Payload = { quotes: HeatmapQuote[]; indices: IndexQuote[]; /** When this index + range last loaded successfully. */ at: number };

export function useHeatmap(index: Instrument, range: HeatmapRange, pollMs = HEATMAP_POLL_MS): HeatmapState {
  const [payloadByKey, setPayloadByKey] = useState<Record<string, Payload | undefined>>({});
  const [tokenExpired, setTokenExpired] = useState(false);
  const [offline, setOffline] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  // Mirrors `tokenExpired` for the poll loop to read synchronously — the
  // loop's closure only changes with `index`/`range`, so it would otherwise
  // see a stale value across ticks.
  const tokenExpiredRef = useRef(false);
  // Lets the refresh button run the *current* poll closure (the one bound to
  // this render's index and range) without duplicating it.
  const pollOnceRef = useRef<(force?: boolean) => Promise<void>>(async () => {});

  const key = `${index}|${range}`;

  useEffect(() => {
    let cancelled = false;
    let inFlight = 0;
    // Requests are numbered so a slow older response (the first, cold load of a
    // long range can outlast a poll tick) can't land after, and overwrite, a newer one.
    let startedSeq = 0;
    let appliedSeq = 0;

    async function pollOnce(force = false) {
      // Scheduled ticks respect a known-bad token; a manual refresh (or the
      // first poll after switching tabs) always goes through, since either is
      // the user telling us something may have changed — e.g. a new token
      // just saved at /settings.
      if (tokenExpiredRef.current && !force) return;

      const seq = ++startedSeq;
      inFlight++;
      let result: UpstoxHeatmapResult;
      try {
        result = await fetchHeatmap(index, range);
      } catch {
        // fetch() rejecting means the request never reached the server —
        // a dropped connection, not anything Upstox- or app-specific.
        result = { error: "network_error" };
      } finally {
        inFlight--;
      }
      // Switched tabs/range (or unmounted) while this was in flight — the
      // newer effect run owns the state now. Same for a response that a newer
      // request has already overtaken.
      if (cancelled || seq < appliedSeq) return;
      appliedSeq = seq;

      if (isUpstoxHeatmapError(result)) {
        if (result.error === "token_expired") {
          // No toast — LivePricingBanners already renders this persistently.
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
        // Neither of these proves the token's state either way, so only a
        // successful response (below) clears tokenExpired.
        return;
      }

      const at = Date.now();
      setPayloadByKey((prev) => ({ ...prev, [key]: { quotes: result.quotes, indices: result.indices, at } }));
      setOffline(false);
      setLoadError(null);
      if (tokenExpiredRef.current) {
        tokenExpiredRef.current = false;
        setTokenExpired(false);
        showToast("Upstox token accepted — live pricing resumed.", "success");
      }
    }

    // A scheduled tick is skipped while the tab is hidden (nobody's looking,
    // and each poll is a ~50-quote request) or while the previous one is still
    // running — a cold long-range load can take longer than the interval.
    function scheduledPoll() {
      if (!document.hidden && inFlight === 0) void pollOnce();
    }
    // Coming back to the tab refreshes right away rather than showing prices
    // up to a full interval stale.
    function handleVisibilityChange() {
      if (!document.hidden && inFlight === 0) void pollOnce();
    }

    pollOnceRef.current = pollOnce;
    pollOnce(true);
    const interval = setInterval(scheduledPoll, pollMs);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [index, range, key, pollMs]);

  async function handleManualRefresh() {
    setManualRefreshing(true);
    try {
      await pollOnceRef.current(true);
    } finally {
      setManualRefreshing(false);
    }
  }

  const payload = payloadByKey[key];
  return {
    quotes: payload?.quotes ?? null,
    indices: payload?.indices ?? null,
    tokenExpired,
    offline,
    loadError,
    lastPolledAt: payload?.at ?? null,
    manualRefreshing,
    handleManualRefresh,
  };
}
