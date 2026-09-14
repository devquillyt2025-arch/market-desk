"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { AlertCircleIcon, InboxIcon, RefreshIcon } from "@/components/icons";
import DatePicker from "@/components/DatePicker";
import {
  computePortfolioRow,
  isTrackableEntry,
  needsExpiryOnly,
  portfolioGroupKey,
  type PortfolioRow,
} from "@/lib/calculatePortfolio";
import { formatINR, pnlColorClass } from "@/lib/format";
import { showToast } from "@/lib/toast";
import {
  describeEntryContract,
  getCachedTradeEntries,
  getTradeEntries,
  setTradeEntryExpiry,
  subscribeToTradeEntryChanges,
  type TradeEntry,
  type TradeEntrySide,
} from "@/lib/tradeEntriesStore";
import { fetchOptionChain } from "@/lib/upstox/client";
import { isUpstoxOptionChainError, type UpstoxOptionChainResult } from "@/lib/upstox/types";

const POLL_MS = 10000;

const tableHeadClass = "whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-muted-foreground";
const badgeClass = "rounded-full bg-muted px-2.5 py-1 font-mono text-xs text-muted-foreground";

const SIDE_LABELS: Record<TradeEntrySide, string> = {
  buy: "Buy",
  sell: "Sell",
};

function formatCellDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function formatGreek(value: number | null, decimals: number): string {
  return value == null ? "—" : value.toFixed(decimals);
}

function formatOi(value: number | null): string {
  return value == null ? "—" : value.toLocaleString("en-IN");
}

/** Sorted chronologically, same convention as Trade Entries. */
function sortEntries(entries: TradeEntry[]): TradeEntry[] {
  return [...entries].sort((a, b) => {
    if (a.entry_date !== b.entry_date) return a.entry_date < b.entry_date ? -1 : 1;
    return a.created_at < b.created_at ? -1 : 1;
  });
}

export default function PortfolioView() {
  const [entries, setEntries] = useState<TradeEntry[] | null>(getCachedTradeEntries);
  const [chainsByGroup, setChainsByGroup] = useState<Record<string, UpstoxOptionChainResult | undefined>>({});
  const [tokenExpired, setTokenExpired] = useState(false);
  const [offline, setOffline] = useState(false);
  const [lastPolledAt, setLastPolledAt] = useState<number | null>(null);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  // Mirrors `tokenExpired` for the poll loop to read synchronously — the
  // loop's own closure is only recreated when `groupKeysDep` changes, so it
  // would otherwise see a stale value across ticks within that window.
  const tokenExpiredRef = useRef(false);
  // Same idea for `offline`, but unlike tokenExpiredRef this one doesn't
  // gate future polls — a dropped connection can come back on its own, so
  // polling keeps retrying every tick instead of stopping until a manual fix.
  const offlineRef = useRef(false);
  // Lets the manual refresh button call the *current* poll closure (which
  // captures this render's groupKeys) without waiting for the next
  // scheduled tick, and without duplicating the polling logic.
  const pollOnceRef = useRef<(force?: boolean) => Promise<void>>(async () => {});

  useEffect(() => {
    async function load() {
      try {
        setEntries(await getTradeEntries());
      } catch {
        showToast("Couldn't load trade entries. Check your connection.");
      }
    }
    load();
    return subscribeToTradeEntryChanges(load);
  }, []);

  // "Open" here means status === "hold" — this app's TRADE_ENTRY_STATUSES
  // are squared_off/hold, not open/closed; hold is the still-live one.
  const openEntries = useMemo(
    () => (entries ? sortEntries(entries.filter((e) => e.status === "hold")) : null),
    [entries],
  );

  const groupKeys = useMemo(() => {
    if (!openEntries) return [];
    const set = new Set(
      openEntries.filter(isTrackableEntry).map((e) => portfolioGroupKey(e.instrument, e.expiry_date)),
    );
    return [...set].sort();
  }, [openEntries]);
  const groupKeysDep = groupKeys.join(",");

  useEffect(() => {
    if (groupKeys.length === 0) return;
    let cancelled = false;

    async function pollOnce(force = false) {
      // The scheduled interval respects a known-bad token (no point
      // re-hitting Upstox every tick with a token we already know fails);
      // a manual refresh always goes through, since a fresh click is the
      // user telling us they think something changed (e.g. they just saved
      // a new token at /settings).
      if (tokenExpiredRef.current && !force) return;

      const results = await Promise.all(
        groupKeys.map(async (key) => {
          const [instrument, expiry] = key.split("|");
          try {
            const data = await fetchOptionChain(instrument as TradeEntry["instrument"], expiry);
            return [key, data] as const;
          } catch {
            // fetch() itself rejecting (as opposed to resolving with a non-ok
            // status, which the route always turns into a normal { error }
            // body) means the request never reached the server at all — a
            // dropped connection, not anything Upstox- or app-specific.
            return [key, { error: "network_error" }] as const;
          }
        }),
      );
      if (cancelled) return;

      const next: Record<string, UpstoxOptionChainResult> = {};
      let anyTokenExpired = false;
      let anyNetworkError = false;
      for (const [key, data] of results) {
        next[key] = data;
        if (isUpstoxOptionChainError(data)) {
          if (data.error === "token_expired") anyTokenExpired = true;
          if (data.error === "network_error") anyNetworkError = true;
        }
      }
      setChainsByGroup(next);
      setLastPolledAt(Date.now());

      if (anyTokenExpired && !tokenExpiredRef.current) {
        tokenExpiredRef.current = true;
        setTokenExpired(true);
        showToast("Upstox token has expired — update it in Settings to resume live pricing.");
      } else if (!anyTokenExpired && tokenExpiredRef.current) {
        // Only reachable via a forced (manual) poll, since the interval
        // stops attempting once expired — a successful forced retry means
        // the token was fixed, so let scheduled polling resume too.
        tokenExpiredRef.current = false;
        setTokenExpired(false);
        showToast("Upstox token accepted — live pricing resumed.", "success");
      }

      if (anyNetworkError && !offlineRef.current) {
        offlineRef.current = true;
        setOffline(true);
        showToast("No internet connection — live pricing is paused until it's back.");
      } else if (!anyNetworkError && offlineRef.current) {
        offlineRef.current = false;
        setOffline(false);
      }
    }

    pollOnceRef.current = pollOnce;
    pollOnce();
    const interval = setInterval(() => pollOnce(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- groupKeys is derived fresh each render; groupKeysDep is its stable identity for this effect.
  }, [groupKeysDep]);

  async function handleManualRefresh() {
    setManualRefreshing(true);
    try {
      await pollOnceRef.current(true);
    } finally {
      setManualRefreshing(false);
    }
  }

  const rows: PortfolioRow[] | null = useMemo(
    () => (openEntries ? openEntries.map((entry) => computePortfolioRow(entry, chainsByGroup)) : null),
    [openEntries, chainsByGroup],
  );

  function handleSetExpiry(entryId: string, expiryDate: string) {
    const previous = entries;
    setEntries((prev) => (prev ? prev.map((e) => (e.id === entryId ? { ...e, expiry_date: expiryDate } : e)) : prev));
    setTradeEntryExpiry(entryId, expiryDate).catch(() => {
      setEntries(previous);
      showToast("Couldn't set the expiry date. Try again.");
    });
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Live Portfolio</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Open positions with live LTP, Greeks, and brokerage-if-squared-off — polled every{" "}
            {POLL_MS / 1000}s. Trade details are edited in Trade Entries.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastPolledAt && !tokenExpired && !offline && (
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              Updated {new Date(lastPolledAt).toLocaleTimeString("en-IN")}
            </span>
          )}
          {groupKeys.length > 0 && (
            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={manualRefreshing}
              aria-label="Refresh now"
              title="Refresh now"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
            >
              <RefreshIcon className={`size-4 ${manualRefreshing ? "animate-spin" : ""}`} />
            </button>
          )}
        </div>
      </div>

      {tokenExpired && (
        <div className="flex items-center gap-3 rounded-xl border border-loss/30 bg-loss/10 px-4 py-3 text-sm text-loss">
          <AlertCircleIcon className="size-4 shrink-0" />
          <span className="flex-1">Your Upstox token has expired. Live pricing is paused until it&apos;s updated.</span>
          <Link
            href="/settings"
            className="shrink-0 whitespace-nowrap rounded-lg border border-loss/40 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-loss/10"
          >
            Update Token
          </Link>
        </div>
      )}

      {offline && !tokenExpired && (
        <div className="flex items-center gap-3 rounded-xl border border-loss/30 bg-loss/10 px-4 py-3 text-sm text-loss">
          <AlertCircleIcon className="size-4 shrink-0" />
          <span className="flex-1">
            No internet connection. Live pricing is paused — it&apos;ll resume automatically once you&apos;re back
            online.
          </span>
        </div>
      )}

      {rows === null ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-11 animate-pulse rounded-lg border border-border bg-card" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card p-10 text-center">
          <InboxIcon className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No open positions. Trades marked &quot;Hold&quot; in Trade Entries show up here.
          </p>
        </div>
      ) : (
        <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left">
                  <th className={`${tableHeadClass} py-3 pl-5 pr-2`}>Date</th>
                  <th className={`${tableHeadClass} px-2 py-3`}>Instrument</th>
                  <th className={`${tableHeadClass} px-2 py-3`}>Side</th>
                  <th className={`${tableHeadClass} px-2 py-3 text-right`}>Lots</th>
                  <th className={`${tableHeadClass} px-2 py-3 text-right`}>Entry Price</th>
                  <th className={`${tableHeadClass} px-2 py-3 text-right`}>Live LTP</th>
                  <th className={`${tableHeadClass} px-2 py-3 text-right`}>Live P&amp;L</th>
                  <th className={`${tableHeadClass} px-2 py-3 text-right`}>Delta</th>
                  <th className={`${tableHeadClass} px-2 py-3 text-right`}>Gamma</th>
                  <th className={`${tableHeadClass} px-2 py-3 text-right`}>Theta</th>
                  <th className={`${tableHeadClass} px-2 py-3 text-right`}>Vega</th>
                  <th className={`${tableHeadClass} px-2 py-3 text-right`}>OI</th>
                  <th className={`${tableHeadClass} px-2 py-3 pr-5 text-right`}>Brokerage if Closed</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {rows.map((row) => {
                    const { entry } = row;
                    return (
                      <motion.tr
                        key={entry.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="border-b border-border last:border-0 hover:bg-muted/30"
                      >
                        <td className="whitespace-nowrap py-2.5 pl-5 pr-2 text-muted-foreground">
                          {formatCellDate(entry.entry_date)}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2.5 font-medium">
                          {describeEntryContract(entry)}
                        </td>
                        <td className="px-2 py-2.5">
                          <span className={badgeClass}>{SIDE_LABELS[entry.side]}</span>
                        </td>
                        <td className="px-2 py-2.5 text-right font-mono tabular-nums">{entry.lots}</td>
                        <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                          {row.entryPrice.toFixed(2)}
                        </td>

                        {row.status === "untracked" ? (
                          <td colSpan={8} className="px-2 py-2.5 text-center">
                            {needsExpiryOnly(entry) ? (
                              <div className="inline-block">
                                <DatePicker
                                  value=""
                                  onChange={(date) => handleSetExpiry(entry.id, date)}
                                  triggerClassName="inline-flex items-center gap-1.5 rounded-full border border-dashed border-accent/40 bg-accent/5 px-3 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/10"
                                />
                              </div>
                            ) : (
                              <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                                Add strike/CE-PE in Trade Entries
                              </span>
                            )}
                          </td>
                        ) : row.status === "error" ? (
                          // token_expired/network_error already have their own
                          // banner above, so this stays short for those and
                          // only surfaces the raw message for anything else —
                          // e.g. Upstox itself returning a 429/500, or the
                          // server failing to read the saved token. Without
                          // this branch the row silently fell through to the
                          // "ok" cells with every value null, indistinguishable
                          // from no_match and with no explanation at all.
                          <td colSpan={8} className="px-2 py-2.5 text-center">
                            <span className="whitespace-nowrap rounded-full bg-loss/10 px-2.5 py-1 text-xs font-medium text-loss">
                              {row.errorMessage === "token_expired"
                                ? "Paused — token expired"
                                : row.errorMessage === "network_error"
                                  ? "Paused — no connection"
                                  : `Couldn't load live data${row.errorMessage ? `: ${row.errorMessage}` : ""}`}
                            </span>
                          </td>
                        ) : row.status === "no_match" ? (
                          // The chain fetch itself succeeded (a real response
                          // came back), but this exact strike wasn't in it —
                          // by far the most common cause is an expiry that
                          // isn't an actual trading date, so offer to fix it
                          // right here rather than a silent dash.
                          <td colSpan={8} className="px-2 py-2.5">
                            <div className="flex items-center justify-center gap-2">
                              <span className="whitespace-nowrap rounded-full bg-loss/10 px-2.5 py-1 text-xs font-medium text-loss">
                                No live data for {entry.expiry_date} — check the expiry
                              </span>
                              <DatePicker
                                value={entry.expiry_date ?? ""}
                                onChange={(date) => handleSetExpiry(entry.id, date)}
                                triggerClassName="inline-flex items-center gap-1.5 rounded-full border border-dashed border-accent/40 bg-accent/5 px-3 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/10"
                              />
                            </div>
                          </td>
                        ) : (
                          <>
                            <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums">
                              {row.liveLtp == null ? "—" : row.liveLtp.toFixed(2)}
                            </td>
                            <td
                              className={`whitespace-nowrap px-2 py-2.5 text-right font-mono font-medium tabular-nums ${
                                row.livePnl == null ? "text-muted-foreground" : pnlColorClass(row.livePnl)
                              }`}
                            >
                              {row.livePnl == null ? "—" : formatINR(row.livePnl)}
                            </td>
                            <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                              {formatGreek(row.delta, 3)}
                            </td>
                            <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                              {formatGreek(row.gamma, 4)}
                            </td>
                            <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                              {formatGreek(row.theta, 2)}
                            </td>
                            <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                              {formatGreek(row.vega, 2)}
                            </td>
                            <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                              {formatOi(row.oi)}
                            </td>
                            <td className="whitespace-nowrap px-2 py-2.5 pr-5 text-right font-mono tabular-nums text-muted-foreground">
                              {row.brokerageIfClosed == null ? "—" : formatINR(row.brokerageIfClosed)}
                            </td>
                          </>
                        )}
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        </section>
      )}
    </motion.div>
  );
}
