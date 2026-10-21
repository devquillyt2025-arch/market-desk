"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

import ConfirmDialog from "@/components/ConfirmDialog";
import { InboxIcon, ListIcon, PlusIcon, RefreshIcon } from "@/components/icons";
import LiveEntriesTable from "@/components/LiveEntriesTable";
import LivePricingBanners from "@/components/LivePricingBanners";
import LoadingState from "@/components/LoadingState";
import OptionChainPicker from "@/components/OptionChainPicker";
import TradeEntryModal from "@/components/TradeEntryModal";
import { computeBalanceSheetRows, type BalanceSheetRow } from "@/lib/calculateBalanceSheet";
import { formatAsOf, formatINR, pnlColorClass } from "@/lib/format";
import {
  addPaperTradeEntry,
  calculateEntryPnl,
  clearPaperTradeEntries,
  deletePaperTradeEntry,
  describeEntryContract,
  getCachedPaperTradeEntries,
  getPaperTradeEntries,
  setPaperTradeExpiry,
  subscribeToPaperTradeChanges,
  updatePaperTradeEntry,
  type AddTradeEntryInput,
} from "@/lib/paperTradeEntriesStore";
import { pickedLegToEntryInput, type PickedLeg } from "@/lib/strategyTransfer";
import { showToast } from "@/lib/toast";
import type { Instrument, PaperTradeEntry, TradeEntrySide } from "@/lib/types";
import { toLivePositionInfo } from "@/lib/calculatePortfolio";
import { useLivePricing } from "@/lib/useLivePricing";

const POLL_MS = 10000;

function todayISODate(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
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

/** Sorted chronologically, same convention as Trade Entries / Live Portfolio. */
function sortEntries(entries: PaperTradeEntry[]): PaperTradeEntry[] {
  return [...entries].sort((a, b) => {
    if (a.entry_date !== b.entry_date) return a.entry_date < b.entry_date ? -1 : 1;
    return a.created_at < b.created_at ? -1 : 1;
  });
}

type ModalState =
  | { mode: "add" }
  | { mode: "edit"; entry: PaperTradeEntry }
  | null;

export default function PaperTradeView() {
  const [entries, setEntries] = useState<PaperTradeEntry[] | null>(getCachedPaperTradeEntries);
  const [modalState, setModalState] = useState<ModalState>(null);
  const [chainOpen, setChainOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PaperTradeEntry | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);

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

  const { rows, tokenExpired, offline, lastPolledAt, stalePricesAsOf, manualRefreshing, groupCount, handleManualRefresh } =
    useLivePricing(openEntries, POLL_MS);

  // The popup's live figures come from the latest poll on every render — not
  // a copy taken when the row was clicked — so they keep matching the row
  // behind it as prices move.
  const editingId = modalState?.mode === "edit" ? modalState.entry.id : null;
  const editingLive = useMemo(
    () => toLivePositionInfo(rows?.find((r) => r.entry.id === editingId)),
    [rows, editingId],
  );

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

  /** Contracts picked on the option-chain ladder become open positions, entered at today's date and the market price. */
  async function handleChainPicked(inst: Instrument, picked: PickedLeg[]) {
    setChainOpen(false);
    const inputs = picked
      .map((p) => pickedLegToEntryInput(inst, p, todayISODate()))
      .filter((i): i is AddTradeEntryInput => i !== null);
    if (inputs.length === 0) {
      showToast("None of the picked contracts had a price yet — try again in a moment.");
      return;
    }
    const results = await Promise.allSettled(inputs.map((input) => addPaperTradeEntry(input)));
    const failed = results.filter((r) => r.status === "rejected").length;
    const added = inputs.length - failed;
    const unpriced = picked.length - inputs.length;
    const skippedNote = unpriced > 0 ? ` ${unpriced} skipped — no price yet.` : "";
    if (failed > 0) showToast(`Added ${added} of ${inputs.length} — ${failed} couldn't be saved. Try again.${skippedNote}`);
    else showToast(`Added ${added} position${added === 1 ? "" : "s"} from the option chain.${skippedNote}`, "success");
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

  function confirmClearAll() {
    setConfirmingClear(false);
    setModalState(null);

    const previous = entries;
    setEntries([]);
    clearPaperTradeEntries().catch(() => {
      setEntries(previous);
      showToast("Couldn't clear the paper trades. Try again.");
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
        <div className="flex flex-wrap items-center gap-2">
          {entries !== null && entries.length > 0 && (
            <button
              type="button"
              onClick={() => setConfirmingClear(true)}
              title="Delete every open and closed paper trade and start fresh"
              className="rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
            >
              Clear All
            </button>
          )}
          <button
            type="button"
            onClick={() => setChainOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
          >
            <ListIcon className="size-4" />
            Option Chain
          </button>
          <button
            type="button"
            onClick={() => setModalState({ mode: "add" })}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 active:scale-95"
          >
            <PlusIcon className="size-4" />
            Add Paper Trade
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Open Positions</h2>
          <div className="flex items-center gap-2">
            {stalePricesAsOf !== null ? (
              <span className="whitespace-nowrap text-xs font-medium text-warning">
                Last prices {formatAsOf(stalePricesAsOf)}
              </span>
            ) : (
              lastPolledAt &&
              !tokenExpired &&
              !offline && (
                <span className="whitespace-nowrap text-xs text-muted-foreground">
                  Updated {new Date(lastPolledAt).toLocaleTimeString("en-IN")}
                </span>
              )
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

        <LivePricingBanners tokenExpired={tokenExpired} offline={offline} lastPricesAt={stalePricesAsOf} />

        {rows === null ? (
          <LoadingState className="h-32" label="Loading open positions…" />
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-background p-8 text-center">
            <InboxIcon className="size-7 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No open paper trades. Add one above with status &quot;Hold&quot; to track it live.
            </p>
          </div>
        ) : (
          <LiveEntriesTable
            rows={rows}
            onSetExpiry={handleSetExpiry}
            onRowClick={(row) => setModalState({ mode: "edit", entry: row.entry })}
          />
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Closed Trades</h2>

        {closedRows === null ? (
          <LoadingState className="h-32" label="Loading closed trades…" />
        ) : closedRows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-background p-8 text-center">
            <InboxIcon className="size-7 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No closed paper trades yet.</p>
          </div>
        ) : (
          <section className="overflow-hidden rounded-xl border border-border bg-background">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] border-collapse text-sm">
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
        {chainOpen && (
          <OptionChainPicker
            key="chain"
            initialInstrument="NIFTY"
            doneLabel={(n) => `Add ${n} position${n === 1 ? "" : "s"}`}
            onDone={handleChainPicked}
            onClose={() => setChainOpen(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {modalState && (
          <TradeEntryModal
            key={modalState.mode === "edit" ? modalState.entry.id : "new"}
            entry={modalState.mode === "edit" ? modalState.entry : null}
            live={editingLive}
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

      <AnimatePresence>
        {confirmingClear && (
          <ConfirmDialog
            title="Clear all paper trades?"
            message={`This deletes all ${entries?.length ?? 0} paper trade${entries?.length === 1 ? "" : "s"}, open and closed — this can't be undone.`}
            confirmLabel="Clear All"
            onConfirm={confirmClearAll}
            onCancel={() => setConfirmingClear(false)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
