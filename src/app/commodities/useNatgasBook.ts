/**
 * The natural gas positions held, priced live, for the natural gas desk. It reads the same Live Portfolio entries the
 * Live Portfolio tab shows (the journal's mirror of the Upstox account - nothing is written from here) and prices them with
 * the same polling engine, but only while `pricing` is on (MCX is shut and the desk wants them) and only if some are held:
 * otherwise nothing is polled at all.
 */

import { useEffect, useMemo, useState } from "react";

import type { PortfolioRow } from "@/lib/calculatePortfolio";
import { expectedOpenMarketFor } from "@/lib/expectedOpen";
import { getCachedLivePortfolioEntries, getLivePortfolioEntries, subscribeToLivePortfolioChanges } from "@/lib/livePortfolioEntriesStore";
import type { LivePortfolioEntry } from "@/lib/types";
import { useLivePricing } from "@/lib/useLivePricing";

/** Slower than the Live Portfolio's own poll: with MCX shut the prices do not move, and a change of position is picked up from the table at once. */
const BOOK_POLL_MS = 60_000;

export type NatgasBook = {
  /** Open natural gas positions in the Live Portfolio; null until they have loaded. */
  held: number | null;
  /** Their live rows, once priced; null while loading, when none are held, or while `pricing` is off. */
  rows: PortfolioRow[] | null;
  tokenExpired: boolean;
};

export function useNatgasBook(pricing: boolean): NatgasBook {
  const [entries, setEntries] = useState<LivePortfolioEntry[] | null>(getCachedLivePortfolioEntries);

  useEffect(() => {
    async function load() {
      try {
        setEntries(await getLivePortfolioEntries());
      } catch {
        // Keep what is shown; the desk simply has no positions to add to its numbers.
      }
    }
    void load();
    return subscribeToLivePortfolioChanges(load);
  }, []);

  const open = useMemo(
    () => (entries ? entries.filter((e) => e.status === "hold" && expectedOpenMarketFor(e.instrument) === "NATURALGAS") : null),
    [entries],
  );
  const live = useLivePricing(pricing && open && open.length > 0 ? open : null, BOOK_POLL_MS);

  return { held: open ? open.length : null, rows: live.rows, tokenExpired: live.tokenExpired };
}
