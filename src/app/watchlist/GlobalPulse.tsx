"use client";

import { useGlobalMarketsContext } from "@/components/GlobalMarketsProvider";
import { buildStrip, marketsStatus } from "@/lib/globalMarkets";
import { GLOBAL_MARKETS_POLL_MS } from "@/lib/useGlobalMarkets";

import { PulseRefresh, StatusPill } from "./PulseParts";

/**
 * The status line along the bottom of the Watchlist's header card while the Global markets tab is showing - the counterpart
 * of MarketPulse: the state of the price feed (live and ~10 minutes behind, markets closed, offline ...), when the prices are from,
 * and a refresh. The numbers are the strip's own - one shared poll - so a refresh here refreshes the strip too.
 */
export function GlobalPulse() {
  const { quotes, offline, feedError, lastPolledAt, loading, refreshing, refresh } = useGlobalMarketsContext();
  const { tone, summary } = marketsStatus({ items: buildStrip(quotes), loading, offline, feedError, reference: lastPolledAt ?? 0 });
  const problem = tone === "problem";
  const dot = problem ? "bg-warning" : tone === "live" ? "bg-profit shadow-[0_0_8px_var(--profit)]" : "bg-muted-foreground/50";

  return (
    <div className="flex min-h-10 flex-wrap items-center gap-x-5 gap-y-3">
      <StatusPill dot={dot} title="Prices come from Yahoo Finance's public feed, which runs about 10 minutes behind the exchanges.">
        <span className={problem ? "font-medium text-warning" : "text-muted-foreground"}>{summary}</span>
      </StatusPill>
      <div className="ml-auto">
        <PulseRefresh
          lastPolledAt={lastPolledAt}
          stale={problem}
          refreshing={refreshing}
          onRefresh={() => void refresh()}
          label="Refresh global prices now"
          title={`Syncs every ${GLOBAL_MARKETS_POLL_MS / 1000} s`}
        />
      </div>
    </div>
  );
}
