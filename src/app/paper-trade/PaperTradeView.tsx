"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

import ConfirmDialog from "@/components/ConfirmDialog";
import { InboxIcon, PencilIcon, PlusIcon, RefreshIcon, TrashIcon } from "@/components/icons";
import LiveEntriesTable from "@/components/LiveEntriesTable";
import LivePricingBanners from "@/components/LivePricingBanners";
import TradeEntryModal from "@/components/TradeEntryModal";
import { computeBalanceSheetRows, type BalanceSheetRow } from "@/lib/calculateBalanceSheet";
import { formatINR, pnlColorClass } from "@/lib/format";
import {
  addPaperTradeEntry,
  calculateEntryPnl,
  deletePaperTradeEntry,
  describeEntryContract,
  getCachedPaperTradeEntries,
  getPaperTradeEntries,
  setPaperTradeExpiry,
  subscribeToPaperTradeChanges,
  updatePaperTradeEntry,
  type AddTradeEntryInput,
} from "@/lib/paperTradeEntriesStore";
import { showToast } from "@/lib/toast";
import type { PaperTradeEntry, TradeEntrySide } from "@/lib/types";
import { useLivePricing } from "@/lib/useLivePricing";

const POLL_MS = 10000;

const tableHeadClass = "whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-muted-foreground";
const badgeClass = "rounded-full bg-muted px-2.5 py-1 font-mono text-xs text-muted-foreground";

const SIDE_LABELS: Record<TradeEntrySide, string> = {
  buy: "Buy",
  sell: "Sell",
};

function formatCellDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/** Sorted chronologically, same convention as Trade Entries / Live Portfolio. */
function sortEntries(entries: PaperTradeEntry[]): PaperTradeEntry[] {
  return [...entries].sort((a, b) => {
    if (a.entry_date !== b.entry_date) return a.entry_date < b.entry_date ? -1 : 1;
    return a.created_at < b.created_at ? -1 : 1;
  });
}

type ModalState = { mode: "add" } | { mode: "edit"; entry: PaperTradeEntry } | null;

export default function PaperTradeView() {
  const [entries, setEntries] = useState<PaperTradeEntry[] | null>(getCachedPaperTradeEntries);
  const [modalState, setModalState] = useState<ModalState>(null);
  const [pendingDelete, setPendingDelete] = useState<PaperTradeEntry | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setEntries(await getPaperTradeEntries());
      } catch {
        showToast("Couldn't load paper trades. Check your connection.");
      }
    }
    load();
    return subscribeToPaperTradeChanges(load);
  }, []);

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
    setPaperTradeExpiry(entryId, expiryDate).catch(() => {
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
        await updatePaperTradeEntry(entry.id, input);
      } catch (err) {
        setEntries(previous);
        throw err;
      }
    } else {
      await addPaperTradeEntry(input);
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
    deletePaperTradeEntry(entry.id).catch(() => {
      setEntries(previous);
      showToast("Couldn't delete the paper trade. Try again.");
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
          <h1 className="text-2xl font-semibold tracking-tight">Paper Trade</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A sandbox for trying out any instrument, strike, or expiry — live-priced like Live Portfolio, but never
            touches real P&amp;L, Reports, or Payment.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModalState({ mode: "add" })}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 active:scale-95"
        >
          <PlusIcon className="size-4" />
          Add Paper Trade
        </button>
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
          <div className="flex flex-col gap-3">
            {[0, 1].map((i) => (
              <div key={i} className="h-11 animate-pulse rounded-lg border border-border bg-card" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card p-8 text-center">
            <InboxIcon className="size-7 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No open paper trades. Add one above with status &quot;Hold&quot; to track it live.
            </p>
          </div>
        ) : (
          <LiveEntriesTable rows={rows} onSetExpiry={handleSetExpiry} />
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Closed Trades</h2>

        {closedRows === null ? (
          <div className="flex flex-col gap-3">
            {[0, 1].map((i) => (
              <div key={i} className="h-11 animate-pulse rounded-lg border border-border bg-card" />
            ))}
          </div>
        ) : closedRows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card p-8 text-center">
            <InboxIcon className="size-7 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No closed paper trades yet.</p>
          </div>
        ) : (
          <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-left">
                    <th className={`${tableHeadClass} py-3 pl-5 pr-2`}>SL</th>
                    <th className={`${tableHeadClass} px-2 py-3`}>Date</th>
                    <th className={`${tableHeadClass} px-2 py-3`}>Instrument</th>
                    <th className={`${tableHeadClass} px-2 py-3`}>Side</th>
                    <th className={`${tableHeadClass} px-2 py-3 text-right`}>Lots</th>
                    <th className={`${tableHeadClass} px-2 py-3 text-right`}>Buy Price</th>
                    <th className={`${tableHeadClass} px-2 py-3 text-right`}>Sell Price</th>
                    <th className={`${tableHeadClass} px-2 py-3 text-right`}>P&amp;L</th>
                    <th className={`${tableHeadClass} px-2 py-3`}>Remarks</th>
                    <th className="w-20 py-3 pr-4" />
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
                        className="border-b border-border last:border-0 hover:bg-muted/30"
                      >
                        <td className="py-2.5 pl-5 pr-2 text-muted-foreground">{row.slNo}</td>
                        <td className="whitespace-nowrap px-2 py-2.5">{formatCellDate(row.entry_date)}</td>
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
                        <td className="py-2.5 pr-4">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => setModalState({ mode: "edit", entry: row })}
                              aria-label={`Edit paper trade ${row.slNo}`}
                              className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/10 hover:text-accent active:scale-90"
                            >
                              <PencilIcon className="size-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setPendingDelete(row)}
                              aria-label={`Delete paper trade ${row.slNo}`}
                              className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-loss/10 hover:text-loss active:scale-90"
                            >
                              <TrashIcon className="size-4" />
                            </button>
                          </div>
                        </td>
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
            onSave={handleModalSave}
            onClose={() => setModalState(null)}
            onDelete={handleModalDelete}
            entityLabel="Paper Trade"
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {pendingDelete && (
          <ConfirmDialog
            title="Delete this paper trade?"
            message={`${describeEntryContract(pendingDelete)} · ${SIDE_LABELS[pendingDelete.side]} — this can't be undone.`}
            onConfirm={confirmDelete}
            onCancel={() => setPendingDelete(null)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
