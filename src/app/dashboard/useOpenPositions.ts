/**
 * The open book for the Dashboard: every open position in the Live Portfolio, priced live, with the figures the page shows at the
 * top (live P&L, today's P&L, margin) and the risk read (chance of profit, theta, a 1% move). It reads the same entries the Live
 * Portfolio tab shows (the journal's mirror of the Upstox account) and prices them with the same engine and the same sums - nothing
 * is written from here. A quick look, so once every 15 seconds rather than the Live Portfolio's 10.
 */

import { useEffect, useMemo, useState } from "react";

import type { PortfolioRow } from "@/lib/calculatePortfolio";
import { analyzeRisk, type RiskAnalysis } from "@/lib/calculateRisk";
import { getCachedLivePortfolioEntries, getLivePortfolioEntries, subscribeToLivePortfolioChanges } from "@/lib/livePortfolioEntriesStore";
import { localIsoDate } from "@/lib/localDate";
import { computePortfolioStats, type PortfolioStats } from "@/lib/portfolioStats";
import type { LivePortfolioEntry } from "@/lib/types";
import { fetchPositions } from "@/lib/upstox/client";
import { isUpstoxPositionsError, type UpstoxPosition } from "@/lib/upstox/types";
import { useLivePricing } from "@/lib/useLivePricing";
import { useMargin } from "@/lib/useMargin";

const PRICE_POLL_MS = 15_000;
const POSITIONS_POLL_MS = 60_000;

export type OpenBook = {
  /** The open (hold) entries; null until they have loaded. */
  entries: LivePortfolioEntry[] | null;
  /** Their live rows; null until the entries have loaded. */
  rows: PortfolioRow[] | null;
  /** Live and today's P&L; null until the rows exist. */
  stats: PortfolioStats | null;
  /** Margin Upstox blocks for the open positions; null until it has said. */
  margin: number | null;
  /** The Live Portfolio's risk read; null with nothing priced to analyse. */
  risk: RiskAnalysis | null;
  tokenExpired: boolean;
  /** When the prices were last fetched (ms); null before the first. */
  pricedAt: number | null;
  /** When the journal's copy of the account was last written (ms); null with no position. */
  syncedAt: number | null;
};

/** Today's positions as Upstox reports them - the squared-off ones too, which the open rows no longer show. Only read; the Live Portfolio tab is what saves them. */
function useTodaysPositions(): UpstoxPosition[] | null {
  const [positions, setPositions] = useState<UpstoxPosition[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Like the Live Portfolio's own polling, a lapsed token stops the scheduled asks: coming back to the page tries again.
    let tokenLapsed = false;

    async function poll() {
      if (document.hidden || tokenLapsed) return;
      const result = await fetchPositions();
      if (cancelled) return;
      if (isUpstoxPositionsError(result)) {
        tokenLapsed = result.error === "token_expired";
        return;
      }
      setPositions(result.positions);
    }

    void poll();
    const interval = setInterval(() => void poll(), POSITIONS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return positions;
}

export function useOpenPositions(): OpenBook {
  const [all, setAll] = useState<LivePortfolioEntry[] | null>(getCachedLivePortfolioEntries);

  useEffect(() => {
    async function load() {
      try {
        setAll(await getLivePortfolioEntries());
      } catch {
        // Keep what is shown: there is simply nothing newer.
      }
    }
    void load();
    return subscribeToLivePortfolioChanges(load);
  }, []);

  const entries = useMemo(() => (all ? all.filter((e) => e.status === "hold") : null), [all]);
  const live = useLivePricing(entries, PRICE_POLL_MS);
  const { totalMargin } = useMargin(live.rows);
  const positions = useTodaysPositions();

  const stats = useMemo(() => (live.rows ? computePortfolioStats(live.rows, positions, localIsoDate()) : null), [live.rows, positions]);

  // The moment the figures are from: the poll's own timestamp (not the clock), so the analysis only recomputes when fresh prices arrive.
  const riskAsOf = live.stalePricesAsOf ?? live.lastPolledAt;
  const risk = useMemo(
    () => (live.rows && live.rows.length > 0 && riskAsOf ? analyzeRisk(live.rows, { now: new Date(riskAsOf), totalMargin, unrealizedPnl: stats?.unrealizedPnl ?? 0 }) : null),
    [live.rows, riskAsOf, totalMargin, stats],
  );

  const syncedAt = useMemo(() => {
    const times = (entries ?? []).map((e) => Date.parse(e.updated_at)).filter(Number.isFinite);
    return times.length > 0 ? Math.max(...times) : null;
  }, [entries]);

  return { entries, rows: live.rows, stats, margin: totalMargin, risk, tokenExpired: live.tokenExpired, pricedAt: live.lastPolledAt, syncedAt };
}
