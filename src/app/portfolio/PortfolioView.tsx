"use client";

import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

import { InboxIcon, RefreshIcon } from "@/components/icons";
import LiveEntriesTable from "@/components/LiveEntriesTable";
import LivePricingBanners from "@/components/LivePricingBanners";
import { useLivePricing } from "@/lib/useLivePricing";
import { showToast } from "@/lib/toast";
import {
  getCachedTradeEntries,
  getTradeEntries,
  setTradeEntryExpiry,
  subscribeToTradeEntryChanges,
  type TradeEntry,
} from "@/lib/tradeEntriesStore";

const POLL_MS = 10000;

/** Sorted chronologically, same convention as Trade Entries. */
function sortEntries(entries: TradeEntry[]): TradeEntry[] {
  return [...entries].sort((a, b) => {
    if (a.entry_date !== b.entry_date) return a.entry_date < b.entry_date ? -1 : 1;
    return a.created_at < b.created_at ? -1 : 1;
  });
}

export default function PortfolioView() {
  const [entries, setEntries] = useState<TradeEntry[] | null>(getCachedTradeEntries);

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

  const { rows, tokenExpired, offline, lastPolledAt, manualRefreshing, groupCount, handleManualRefresh } =
    useLivePricing(openEntries, POLL_MS);

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
          {groupCount > 0 && (
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

      <LivePricingBanners tokenExpired={tokenExpired} offline={offline} />

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
        <LiveEntriesTable rows={rows} onSetExpiry={handleSetExpiry} />
      )}
    </motion.div>
  );
}
