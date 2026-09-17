"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";

import ConfirmDialog from "@/components/ConfirmDialog";
import LoadingState from "@/components/LoadingState";
import { DownloadIcon, InboxIcon, PlusIcon, RefreshIcon, UploadIcon } from "@/components/icons";
import LiveEntriesTable from "@/components/LiveEntriesTable";
import LivePricingBanners from "@/components/LivePricingBanners";
import TradeEntryModal, { type LiveGreeksInfo } from "@/components/TradeEntryModal";
import { computeBalanceSheetRows, type BalanceSheetRow } from "@/lib/calculateBalanceSheet";
import { formatINR, pnlColorClass } from "@/lib/format";
import {
  addLivePortfolioEntry,
  calculateEntryPnl,
  deleteLivePortfolioEntry,
  describeEntryContract,
  getCachedLivePortfolioEntries,
  getLivePortfolioEntries,
  importLivePortfolioEntries,
  setLivePortfolioExpiry,
  subscribeToLivePortfolioChanges,
  updateLivePortfolioEntry,
  type AddTradeEntryInput,
} from "@/lib/livePortfolioEntriesStore";
import { showToast } from "@/lib/toast";
import type { LivePortfolioEntry, TradeEntrySide } from "@/lib/types";
import { useLivePricing } from "@/lib/useLivePricing";

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

const tableHeadClass = "whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-muted-foreground";
const badgeClass = "rounded-full border border-border bg-background px-2.5 py-1 font-mono text-xs text-muted-foreground";

const SIDE_LABELS: Record<TradeEntrySide, string> = {
  buy: "Buy",
  sell: "Sell",
};

function formatCellDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/** Sorted chronologically, same convention as Trade Entries / Paper Trade. */
function sortEntries(entries: LivePortfolioEntry[]): LivePortfolioEntry[] {
  return [...entries].sort((a, b) => {
    if (a.entry_date !== b.entry_date) return a.entry_date < b.entry_date ? -1 : 1;
    return a.created_at < b.created_at ? -1 : 1;
  });
}

type ModalState =
  | { mode: "add" }
  | { mode: "edit"; entry: LivePortfolioEntry; liveGreeks?: LiveGreeksInfo }
  | null;

export default function PortfolioView() {
  const [entries, setEntries] = useState<LivePortfolioEntry[] | null>(getCachedLivePortfolioEntries);
  const [modalState, setModalState] = useState<ModalState>(null);
  const [pendingDelete, setPendingDelete] = useState<LivePortfolioEntry | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // "Open" here means status === "hold" — this app's TRADE_ENTRY_STATUSES
  // are squared_off/hold, not open/closed; hold is the still-live one.
  const openEntries = useMemo(
    () => (entries ? sortEntries(entries.filter((e) => e.status === "hold")) : null),
    [entries],
  );
  const closedRows: BalanceSheetRow[] | null = useMemo(
    () => (entries ? computeBalanceSheetRows(entries.filter((e) => e.status === "squared_off")) : null),
    [entries],
  );

  const { rows, tokenExpired, offline, lastPolledAt, manualRefreshing, groupCount, handleManualRefresh } =
    useLivePricing(openEntries, POLL_MS);

  function handleSetExpiry(entryId: string, expiryDate: string) {
    const previous = entries;
    setEntries((prev) => (prev ? prev.map((e) => (e.id === entryId ? { ...e, expiry_date: expiryDate } : e)) : prev));
    setLivePortfolioExpiry(entryId, expiryDate).catch(() => {
      setEntries(previous);
      showToast("Couldn't set the expiry date. Try again.");
    });
  }

  async function handleModalSave(input: AddTradeEntryInput) {
    if (modalState?.mode === "edit") {
      const { entry } = modalState;
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
    } else {
      await addLivePortfolioEntry(input);
    }
    setModalState(null);
  }

  function handleModalDelete() {
    if (modalState?.mode !== "edit") return;
    setPendingDelete(modalState.entry);
  }

  function confirmDelete() {
    if (!pendingDelete) return;
    const entry = pendingDelete;
    setPendingDelete(null);
    setModalState(null);

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
    downloadJson(`live-portfolio-${todayISODate()}.json`, entries);
  }

  function handleImportClick() {
    fileInputRef.current?.click();
  }

  async function handleImportFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so choosing the same file again still fires onChange
    if (!file) return;

    setImporting(true);
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      const result = await importLivePortfolioEntries(parsed);
      showToast(`Imported ${result.inserted} new, updated ${result.updated}.`, "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't import — check the file is valid JSON.");
    } finally {
      setImporting(false);
    }
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
            Its own independent positions — live LTP, Greeks, and brokerage-if-squared-off, polled every{" "}
            {POLL_MS / 1000}s. Add, edit, or delete right here.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            onChange={handleImportFile}
            className="hidden"
          />
          <button
            type="button"
            onClick={handleImportClick}
            disabled={importing}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60 active:scale-95"
          >
            <UploadIcon className="size-4" />
            {importing ? "Importing…" : "Import"}
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
          >
            <DownloadIcon className="size-4" />
            Export
          </button>
          <button
            type="button"
            onClick={() => setModalState({ mode: "add" })}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 active:scale-95"
          >
            <PlusIcon className="size-4" />
            Add Position
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Open Positions</h2>
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
          <LoadingState className="h-40" label="Loading open positions…" />
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-background p-10 text-center">
            <InboxIcon className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No open positions. Add one above with status &quot;Hold&quot; to track it live.
            </p>
          </div>
        ) : (
          <LiveEntriesTable
            rows={rows}
            onSetExpiry={handleSetExpiry}
            onRowClick={(row) =>
              setModalState({
                mode: "edit",
                entry: row.entry,
                liveGreeks:
                  row.status === "ok"
                    ? { delta: row.delta, gamma: row.gamma, theta: row.theta, vega: row.vega, oi: row.oi }
                    : undefined,
              })
            }
          />
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Closed Positions</h2>

        {closedRows === null ? (
          <LoadingState className="h-32" label="Loading closed positions…" />
        ) : closedRows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-background p-8 text-center">
            <InboxIcon className="size-7 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No closed positions yet.</p>
          </div>
        ) : (
          <section className="overflow-hidden rounded-xl border border-border bg-background">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1020px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className={`${tableHeadClass} py-3 pl-5 pr-2`}>SL</th>
                    <th className={`${tableHeadClass} px-2 py-3`}>Date</th>
                    <th className={`${tableHeadClass} px-2 py-3`}>Closing Date</th>
                    <th className={`${tableHeadClass} px-2 py-3`}>Instrument</th>
                    <th className={`${tableHeadClass} px-2 py-3`}>Side</th>
                    <th className={`${tableHeadClass} px-2 py-3 text-right`}>Lots</th>
                    <th className={`${tableHeadClass} px-2 py-3 text-right`}>Buy Price</th>
                    <th className={`${tableHeadClass} px-2 py-3 text-right`}>Sell Price</th>
                    <th className={`${tableHeadClass} px-2 py-3 text-right`}>P&amp;L</th>
                    <th className={`${tableHeadClass} px-2 py-3`}>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence initial={false}>
                    {closedRows.map((row) => (
                      <motion.tr
                        key={row.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        onClick={() => setModalState({ mode: "edit", entry: row })}
                        className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/30"
                      >
                        <td className="py-2.5 pl-5 pr-2 text-muted-foreground">{row.slNo}</td>
                        <td className="whitespace-nowrap px-2 py-2.5">{formatCellDate(row.entry_date)}</td>
                        <td className="whitespace-nowrap px-2 py-2.5 text-muted-foreground">
                          {row.closing_date ? formatCellDate(row.closing_date) : "—"}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2.5 font-medium">{describeEntryContract(row)}</td>
                        <td className="px-2 py-2.5">
                          <span className={badgeClass}>{SIDE_LABELS[row.side]}</span>
                        </td>
                        <td className="px-2 py-2.5 text-right font-mono tabular-nums">{row.lots}</td>
                        <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                          {row.buy_price.toFixed(2)}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                          {row.sell_price.toFixed(2)}
                        </td>
                        <td
                          className={`whitespace-nowrap px-2 py-2.5 text-right font-mono font-medium tabular-nums ${pnlColorClass(row.pnl)}`}
                        >
                          {formatINR(row.pnl)}
                        </td>
                        <td className="max-w-40 truncate px-2 py-2.5 text-muted-foreground">{row.remarks || "—"}</td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      <AnimatePresence>
        {modalState && (
          <TradeEntryModal
            key={modalState.mode === "edit" ? modalState.entry.id : "new"}
            entry={modalState.mode === "edit" ? modalState.entry : null}
            liveGreeks={modalState.mode === "edit" ? modalState.liveGreeks : undefined}
            onSave={handleModalSave}
            onClose={() => setModalState(null)}
            onDelete={handleModalDelete}
            entityLabel="Live Position"
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {pendingDelete && (
          <ConfirmDialog
            title="Delete this position?"
            message={`${describeEntryContract(pendingDelete)} · ${SIDE_LABELS[pendingDelete.side]} — this can't be undone.`}
            onConfirm={confirmDelete}
            onCancel={() => setPendingDelete(null)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
