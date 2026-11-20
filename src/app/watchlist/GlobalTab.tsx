"use client";

import { GLOBAL_TOP_UPSTOX_ITEMS } from "@/lib/globalIndicesTable";
import { useWatchlistQuotes } from "@/lib/useWatchlistQuotes";
import type { WorldIndicesState } from "@/lib/useWorldIndices";

import { GlobalIndicesSection } from "./GlobalIndicesSection";
import { GlobalMarketsSection } from "./GlobalMarketsSection";

/** The Upstox side of the Global indices table is two instruments in one call, and Upstox quotes them within a minute - ten seconds is ample. */
const UPSTOX_TOP_POLL_MS = 10_000;
/** Kept apart from the Indian list's saved prices, or the two would overwrite each other. */
const UPSTOX_TOP_STORAGE_KEY = "marketdesk:global-top-quotes";

/**
 * The Global markets tab: the headline Global indices first, then the commodities and the rupee (with where MCX is expected to
 * open). The Yahoo levels (`world`) are polled by the page; the Upstox side of the table (GIFT Nifty, the Dow futures) is polled
 * here, only while this tab is showing - the page mounts it on demand.
 */
export function GlobalTab({ world }: { world: WorldIndicesState }) {
  const upstox = useWatchlistQuotes(GLOBAL_TOP_UPSTOX_ITEMS, UPSTOX_TOP_POLL_MS, UPSTOX_TOP_STORAGE_KEY);

  return (
    <>
      <GlobalIndicesSection world={world} upstox={upstox} />
      <GlobalMarketsSection />
    </>
  );
}
