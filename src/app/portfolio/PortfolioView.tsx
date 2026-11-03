"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

import ClosedTodayTable from "@/components/ClosedTodayTable";
import ConfirmDialog from "@/components/ConfirmDialog";
import LoadingState from "@/components/LoadingState";
import { DownloadIcon, InboxIcon, RefreshIcon } from "@/components/icons";
import LiveEntriesTable from "@/components/LiveEntriesTable";
import LivePricingBanners from "@/components/LivePricingBanners";
import RiskProbabilityPanel from "@/components/RiskProbabilityPanel";
import TradeEntryModal from "@/components/TradeEntryModal";
import {
  calculateTodayPnl,
  isTrackableEntry,
  legSnapshotKey,
  syntheticPrices,
  toLivePositionInfo,
} from "@/lib/calculatePortfolio";
import { analyzeRisk } from "@/lib/calculateRisk";
import { formatAsOf, formatINR, pnlColorClass } from "@/lib/format";
import {
  calculateEntryPnl,
  deleteLivePortfolioEntry,
  describeEntryContract,
  getCachedLivePortfolioEntries,
  getLivePortfolioEntries,
  setLivePortfolioExpiry,
  subscribeToLivePortfolioChanges,
  updateLivePortfolioEntry,
  type AddTradeEntryInput,
} from "@/lib/livePortfolioEntriesStore";
import { showToast } from "@/lib/toast";
import { DEFAULT_LOT_SIZES, type LivePortfolioEntry, type TradeEntrySide } from "@/lib/types";
import { positionContractKey, positionDayPnl } from "@/lib/upstoxSync";
import { useLivePricing } from "@/lib/useLivePricing";
import { useMargin } from "@/lib/useMargin";
import { useUpstoxPositions } from "@/lib/useUpstoxPositions";

const POLL_MS = 10000;

function todayISODate(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}


const SIDE_LABELS: Record<TradeEntrySide, string> = {
  buy: "Buy",
  sell: "Sell",
};

/** Sorted chronologically, same convention as Trade Entries / Paper Trade. */
function sortEntries(entries: LivePortfolioEntry[]): LivePortfolioEntry[] {
  return [...entries].sort((a, b) => {
    if (a.entry_date !== b.entry_date) return a.entry_date < b.entry_date ? -1 : 1;
    return a.created_at < b.created_at ? -1 : 1;
  });
}

export default function PortfolioView() {
  const [entries, setEntries] = useState<LivePortfolioEntry[] | null>(getCachedLivePortfolioEntries);
  const [editing, setEditing] = useState<LivePortfolioEntry | null>(null);
  const [pendingDelete, setPendingDelete] = useState<LivePortfolioEntry | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setEntries(await getLivePortfolioEntries());
      } catch {
        showToast("Couldn't load the live portfolio. Check your connection.");
      }
    }
    load();
    return subscribeToLivePortfolioChanges(load);
  }, []);

  // Writes Upstox's positions into the table every minute; the subscription above picks them up.
  const upstox = useUpstoxPositions();

  // "Open" here means status === "hold" — this app's TRADE_ENTRY_STATUSES
  // are squared_off/hold, not open/closed; hold is the still-live one.
  const openEntries = useMemo(
    () => (entries ? sortEntries(entries.filter((e) => e.status === "hold")) : null),
    [entries],
  );

  const { rows, tokenExpired, offline, lastPolledAt, stalePricesAsOf, manualRefreshing, handleManualRefresh } =
    useLivePricing(openEntries, POLL_MS);
  const { totalMargin } = useMargin(rows);

  // Only today's sync counts — positions from an earlier day (the token
  // lapsed overnight and nothing has synced since) aren't today's anything.
  const todaysPositions = useMemo(
    () =>
      upstox.syncedAt !== null && new Date(upstox.syncedAt).toDateString() === new Date().toDateString()
        ? upstox.positions
        : null,
    [upstox.positions, upstox.syncedAt],
  );
  const closedToday = useMemo(() => (todaysPositions ?? []).filter((p) => p.quantity === 0), [todaysPositions]);

  // Current mark value of open positions (premium terms) and their
  // unrealized P&L — livePnl is already sign-correct for both buy and sell
  // sides, so it's summed directly rather than derived from value math that
  // would get the sign backwards for a short position.
  //
  // Today's P&L comes from today's Upstox positions when there are some —
  // they also cover what was squared off today, which the open rows no longer
  // show — with each open contract marked at the live LTP the table polls.
  // Otherwise it falls back to the open rows measured from the previous close
  // (or entry price, if opened today). Null when nothing has anything to
  // measure against (e.g. all prices are from an earlier session), so the
  // tile shows "—" rather than a misleading ₹0.
  const portfolioStats = useMemo(() => {
    if (!rows) return null;
    const today = todayISODate();
    let value = 0;
    let unrealizedPnl = 0;
    for (const row of rows) {
      const qty = row.entry.lots * DEFAULT_LOT_SIZES[row.entry.instrument];
      value += (row.liveLtp ?? row.entryPrice) * qty;
      unrealizedPnl += row.livePnl ?? 0;
    }

    let todayPnl: number | null = null;
    let bookedToday = 0;
    if (todaysPositions && todaysPositions.length > 0) {
      const liveLtpByContract = new Map<string, number>();
      for (const row of rows) {
        if (row.status === "ok" && row.liveLtp != null && isTrackableEntry(row.entry)) {
          liveLtpByContract.set(legSnapshotKey(row.entry), row.liveLtp);
        }
      }
      for (const position of todaysPositions) {
        const pnl = positionDayPnl(position, liveLtpByContract.get(positionContractKey(position)) ?? null);
        if (pnl === null) continue;
        todayPnl = (todayPnl ?? 0) + pnl;
        if (position.quantity === 0) bookedToday += pnl;
      }
    } else {
      for (const row of rows) {
        const rowToday = calculateTodayPnl(row, today);
        if (rowToday !== null) todayPnl = (todayPnl ?? 0) + rowToday;
      }
    }
    return { value, unrealizedPnl, todayPnl, bookedToday };
  }, [rows, todaysPositions]);

  // The moment the figures being analysed are from: the poll timestamp (not
  // Date.now()) so "now" is stable between renders and the analysis only
  // recomputes when fresh prices arrive — or, while rows are showing
  // last-known prices through an outage, when those prices were fetched, so
  // time-to-expiry stays consistent with the spot and premiums it's paired with.
  const riskAsOf = stalePricesAsOf ?? lastPolledAt;
  const riskAnalysis = useMemo(
    () =>
      rows && riskAsOf
        ? analyzeRisk(rows, {
            now: new Date(riskAsOf),
            totalMargin,
            unrealizedPnl: portfolioStats?.unrealizedPnl ?? 0,
          })
        : null,
    [rows, riskAsOf, totalMargin, portfolioStats],
  );

  // A failed poll with no last-known prices to fall back on turns every row
  // into an error, which leaves nothing to analyse. Rather than blank the
  // panel, hold the last good read and flag it as paused. Updated during
  // render (React's "adjust state when a prop changes" pattern) instead of in
  // an effect, so the held copy never lags a render behind.
  const [heldRisk, setHeldRisk] = useState<{ analysis: NonNullable<typeof riskAnalysis>; at: number } | null>(null);
  if (riskAnalysis && riskAsOf && heldRisk?.analysis !== riskAnalysis) {
    setHeldRisk({ analysis: riskAnalysis, at: riskAsOf });
  }
  const riskPaused = (riskAnalysis === null && heldRisk !== null) || stalePricesAsOf !== null;

  // The popup's live figures come from the latest poll on every render — not
  // a copy taken when the row was clicked — so they keep matching the row
  // behind it as prices move.
  const editingId = editing?.id ?? null;
  const editingLive = useMemo(
    () => toLivePositionInfo(rows?.find((r) => r.entry.id === editingId)),
    [rows, editingId],
  );

  // Either feed failing for want of a token / a connection means the same thing to the user.
  const anyTokenExpired = tokenExpired || upstox.tokenExpired;
  const anyOffline = offline || upstox.offline;
  const refreshing = manualRefreshing || upstox.manualSyncing;

  async function handleRefresh() {
    // Positions first, so a newly opened one is in the table before prices are polled.
    await upstox.syncNow();
    await handleManualRefresh();
  }

  function handleSetExpiry(entryId: string, expiryDate: string) {
    const previous = entries;
    setEntries((prev) => (prev ? prev.map((e) => (e.id === entryId ? { ...e, expiry_date: expiryDate } : e)) : prev));
    setLivePortfolioExpiry(entryId, expiryDate).catch(() => {
      setEntries(previous);
      showToast("Couldn't set the expiry date. Try again.");
    });
  }

  async function handleModalSave(input: AddTradeEntryInput) {
    if (!editing) return;
    const entry = editing;
    const previous = entries;
    const pnl = calculateEntryPnl(input);

    setEntries((prev) =>
      prev
        ? prev.map((e) =>
            e.id === entry.id
              ? {
                  ...e,
                  entry_date: input.entryDate,
                  instrument: input.instrument,
                  strike_price: input.strikePrice ?? null,
                  option_type: input.optionType ?? null,
                  expiry_date: input.expiryDate ?? null,
                  closing_date: input.closingDate ?? null,
                  lots: input.lots,
                  side: input.side,
                  buy_price: input.buyPrice,
                  sell_price: input.sellPrice,
                  pnl,
                  status: input.status,
                  remarks: input.remarks ?? null,
                }
              : e,
          )
        : prev,
    );

    try {
      await updateLivePortfolioEntry(entry.id, input);
    } catch (err) {
      setEntries(previous);
      throw err;
    }
    setEditing(null);
  }

  function handleModalDelete() {
    if (!editing) return;
    setPendingDelete(editing);
  }

  function confirmDelete() {
    if (!pendingDelete) return;
    const entry = pendingDelete;
    setPendingDelete(null);
    setEditing(null);

    const previous = entries;
    setEntries((prev) => (prev ? prev.filter((e) => e.id !== entry.id) : prev));
    deleteLivePortfolioEntry(entry.id).catch(() => {
      setEntries(previous);
      showToast("Couldn't delete the position. Try again.");
    });
  }

  function handleExport() {
    if (!entries || entries.length === 0) {
      showToast("No positions to export yet.");
      return;
    }

    // A "hold" entry's own buy_price/sell_price is just its entry price —
    // never updated as the market moves. For a row that's currently
    // live-matched, substitute today's LTP into whichever leg hasn't executed
    // yet, so an export → re-import into Trade Entries (or Paper Trade)
    // carries a live mark-to-market snapshot instead of silently reproducing
    // the stale entry price every time.
    const liveLtpByEntryId = new Map(
      (rows ?? []).filter((r) => r.status === "ok").map((r) => [r.entry.id, r.liveLtp as number]),
    );
    const exportEntries = entries.map((entry) => {
      const liveLtp = liveLtpByEntryId.get(entry.id);
      if (liveLtp == null) return entry;
      const { buyPrice, sellPrice } = syntheticPrices(entry, liveLtp);
      return { ...entry, buy_price: buyPrice, sell_price: sellPrice };
    });

    downloadJson(`live-portfolio-${todayISODate()}.json`, exportEntries);
  }

  // Until the first sync answers, an empty table means "not loaded yet", not "no positions".
  const awaitingFirstSync = upstox.syncedAt === null && !anyTokenExpired && !anyOffline && upstox.error === null;

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
            Your open Upstox positions, synced every minute — live LTP, Greeks, and brokerage-if-squared-off, polled
            every {POLL_MS / 1000}s. For what-if positions, use Paper Trade.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExport}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
          >
            <DownloadIcon className="size-4" />
            Export
          </button>
        </div>
      </div>

      {portfolioStats && (
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-xl border border-border bg-background p-4">
            <dt className="text-xs text-muted-foreground">Total Invested (Margin)</dt>
            <dd className="mt-1 font-mono text-xl font-semibold tabular-nums">
              {totalMargin === null ? "—" : formatINR(totalMargin)}
            </dd>
          </div>
          <div className="rounded-xl border border-border bg-background p-4">
            <dt className="text-xs text-muted-foreground">Total Value</dt>
            <dd className="mt-1 font-mono text-xl font-semibold tabular-nums">{formatINR(portfolioStats.value)}</dd>
          </div>
          <div className="rounded-xl border border-border bg-background p-4">
            <dt className="text-xs text-muted-foreground">Unrealized P&amp;L</dt>
            <dd
              className={`mt-1 font-mono text-xl font-semibold tabular-nums ${pnlColorClass(portfolioStats.unrealizedPnl)}`}
            >
              {formatINR(portfolioStats.unrealizedPnl)}
            </dd>
          </div>
          <div className="rounded-xl border border-border bg-background p-4">
            <dt className="text-xs text-muted-foreground">Today&apos;s P&amp;L</dt>
            <dd className="mt-1">
              <span
                className={`block font-mono text-xl font-semibold tabular-nums ${
                  portfolioStats.todayPnl === null ? "" : pnlColorClass(portfolioStats.todayPnl)
                }`}
              >
                {portfolioStats.todayPnl === null ? "—" : formatINR(portfolioStats.todayPnl)}
              </span>
              {portfolioStats.bookedToday !== 0 && (
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  incl. {formatINR(portfolioStats.bookedToday)} booked
                </span>
              )}
            </dd>
          </div>
        </dl>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Open Positions</h2>
          <div className="flex items-center gap-2">
            {upstox.error ? (
              <span className="text-xs font-medium text-danger-fg">Couldn&apos;t sync with Upstox — {upstox.error}</span>
            ) : stalePricesAsOf !== null ? (
              <span className="whitespace-nowrap text-xs font-medium text-warning">
                Last prices {formatAsOf(stalePricesAsOf)}
              </span>
            ) : (
              !anyTokenExpired &&
              !anyOffline &&
              (upstox.syncedAt || lastPolledAt) && (
                <span className="whitespace-nowrap text-xs text-muted-foreground">
                  {upstox.syncedAt && `Synced ${new Date(upstox.syncedAt).toLocaleTimeString("en-IN")}`}
                  {upstox.syncedAt && lastPolledAt && " · "}
                  {lastPolledAt && `Prices ${new Date(lastPolledAt).toLocaleTimeString("en-IN")}`}
                </span>
              )
            )}
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              aria-label="Sync and refresh now"
              title="Sync and refresh now"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
            >
              <RefreshIcon className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        <LivePricingBanners tokenExpired={anyTokenExpired} offline={anyOffline} lastPricesAt={stalePricesAsOf} />

        {rows === null || (rows.length === 0 && awaitingFirstSync) ? (
          <LoadingState className="h-40" label="Loading positions from Upstox…" />
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-background p-10 text-center">
            <InboxIcon className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {anyTokenExpired
                ? "Add today's Upstox token to load your positions."
                : closedToday.length > 0
                  ? `No open positions right now — ${closedToday.length} squared off today, below.`
                  : "No open positions on your Upstox account right now."}
            </p>
          </div>
        ) : (
          <LiveEntriesTable rows={rows} onSetExpiry={handleSetExpiry} onRowClick={(row) => setEditing(row.entry)} />
        )}

        {upstox.otherCount > 0 && (
          <p className="text-xs text-muted-foreground">
            {upstox.otherCount} Upstox position{upstox.otherCount === 1 ? " isn't" : "s aren't"} shown — Live Portfolio
            tracks Nifty, Bank Nifty and Sensex options only.
          </p>
        )}
      </div>

      {closedToday.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Closed Today</h2>
          <ClosedTodayTable positions={closedToday} />
        </div>
      )}

      {rows && rows.some((r) => r.status !== "untracked") && (
        <RiskProbabilityPanel
          analysis={riskAnalysis ?? heldRisk?.analysis ?? null}
          asOf={riskAnalysis ? riskAsOf : (heldRisk?.at ?? null)}
          paused={riskPaused}
        />
      )}

      <AnimatePresence>
        {editing && (
          <TradeEntryModal
            key={editing.id}
            entry={editing}
            live={editingLive}
            onSave={handleModalSave}
            onClose={() => setEditing(null)}
            onDelete={handleModalDelete}
            entityLabel="Live Position"
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {pendingDelete && (
          <ConfirmDialog
            title="Delete this position?"
            message={`${describeEntryContract(pendingDelete)} · ${SIDE_LABELS[pendingDelete.side]} — if it's still open on Upstox, the next sync adds it back.`}
            onConfirm={confirmDelete}
            onCancel={() => setPendingDelete(null)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
