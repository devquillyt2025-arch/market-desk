/**
 * Upstox's P&L report for the dashboard's reports card. Reports itself reads it afresh every time it opens; the dashboard is the page
 * this one opens on, so it would ask Upstox for three financial years of trades on every visit. It reads the copy Reports keeps on this
 * device (see reportCache.ts) when that is under half an hour old, and asks only when it is older or missing - saving what it gets
 * under the same key, so Reports benefits too. A failure keeps the old copy on screen, with `error` saying why it is old.
 */

import { useCallback, useEffect, useState } from "react";

import { fetchPnlTrades } from "@/lib/upstox/client";
import { parseStoredReport, REPORT_CACHE_KEY } from "@/lib/upstox/reportCache";
import { isUpstoxPnlTradesError, type UpstoxReportTrade } from "@/lib/upstox/types";

/** A saved report younger than this is used as it is. */
export const FRESH_REPORT_MS = 30 * 60_000;

function readSaved() {
  try {
    return parseStoredReport(localStorage.getItem(REPORT_CACHE_KEY));
  } catch {
    return null;
  }
}

export type ReportBriefState = {
  /** Null until there is anything to show. */
  trades: UpstoxReportTrade[] | null;
  /** When `trades` was fetched from Upstox. */
  fetchedAt: number | null;
  /** "token_expired", "network_error" or Upstox's own message - set when the latest ask failed. */
  error: string | null;
  /** Nothing to show yet, and Upstox is being asked. */
  loading: boolean;
};

export function useReportBrief(): ReportBriefState {
  const [state, setState] = useState<{ trades: UpstoxReportTrade[] | null; fetchedAt: number | null; error: string | null; done: boolean }>({ trades: null, fetchedAt: null, error: null, done: false });

  const load = useCallback(async () => {
    const saved = readSaved();
    if (saved && Date.now() - saved.fetchedAt < FRESH_REPORT_MS) {
      setState({ trades: saved.trades, fetchedAt: saved.fetchedAt, error: null, done: true });
      return;
    }
    const result = await fetchPnlTrades();
    if (isUpstoxPnlTradesError(result)) {
      // An old copy is better than none: show it, and say why it is old.
      setState({ trades: saved?.trades ?? null, fetchedAt: saved?.fetchedAt ?? null, error: result.error, done: true });
      return;
    }
    try {
      localStorage.setItem(REPORT_CACHE_KEY, JSON.stringify({ fetchedAt: result.fetchedAt, trades: result.trades }));
    } catch {
      // Storage may be full; the next visit just asks again.
    }
    setState({ trades: result.trades, fetchedAt: result.fetchedAt, error: null, done: true });
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return { trades: state.trades, fetchedAt: state.fetchedAt, error: state.error, loading: !state.done };
}
