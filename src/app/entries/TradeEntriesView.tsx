"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";

import {
  ArrowUpDownIcon,
  DownloadIcon,
  InboxIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
  UploadIcon,
} from "@/components/icons";
import ConfirmDialog from "@/components/ConfirmDialog";
import Select from "@/components/Select";
import { computeBalanceSheetRows, type BalanceSheetRow } from "@/lib/calculateBalanceSheet";
import { summarizeEntries } from "@/lib/calculateReports";
import { formatINR, pnlColorClass } from "@/lib/format";
import { showToast } from "@/lib/toast";
import { INSTRUMENT_LABELS, INSTRUMENTS, type Instrument } from "@/lib/types";
import {
  addTradeEntry,
  calculateEntryPnl,
  deleteTradeEntry,
  describeEntryContract,
  getCachedTradeEntries,
  getTradeEntries,
  importTradeEntries,
  subscribeToTradeEntryChanges,
  updateTradeEntry,
  type AddTradeEntryInput,
  type TradeEntry,
  type TradeEntrySide,
  type TradeEntryStatus,
} from "@/lib/tradeEntriesStore";
import TradeEntryModal from "@/components/TradeEntryModal";

const badgeClass = "rounded-full bg-muted px-2.5 py-1 font-mono text-xs text-muted-foreground";
const tableHeadClass = "whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-muted-foreground";

const STATUS_LABELS: Record<TradeEntryStatus, string> = {
  squared_off: "Squared Off",
  hold: "Hold",
};

const STATUS_CLASSES: Record<TradeEntryStatus, string> = {
  squared_off: "bg-profit/10 text-profit",
  hold: "bg-accent/10 text-accent",
};

const SIDE_LABELS: Record<TradeEntrySide, string> = {
  buy: "Buy",
  sell: "Sell",
};

function todayISODate(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function rupees(value: number): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}₹ ${Math.abs(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatCellDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

type SortField = "date" | "pnl" | "buyPrice" | "sellPrice" | "lots";
type SortDir = "asc" | "desc";

const SORT_FIELD_OPTIONS: { value: SortField; label: string }[] = [
  { value: "date", label: "Date" },
  { value: "pnl", label: "P&L" },
  { value: "buyPrice", label: "Buy Price" },
  { value: "sellPrice", label: "Sell Price" },
  { value: "lots", label: "Lots" },
];

const STATUS_FILTER_OPTIONS: { value: TradeEntryStatus | "all"; label: string }[] = [
  { value: "all", label: "All Statuses" },
  { value: "hold", label: "Hold" },
  { value: "squared_off", label: "Squared Off" },
];

const SIDE_FILTER_OPTIONS: { value: TradeEntrySide | "all"; label: string }[] = [
  { value: "all", label: "All Sides" },
  { value: "buy", label: "Buy" },
  { value: "sell", label: "Sell" },
];

const INSTRUMENT_FILTER_OPTIONS: { value: Instrument | "all"; label: string }[] = [
  { value: "all", label: "All Instruments" },
  ...INSTRUMENTS.map((i) => ({ value: i, label: INSTRUMENT_LABELS[i] })),
];

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

type ModalState = { mode: "add" } | { mode: "edit"; entry: TradeEntry } | null;

export default function TradeEntriesView() {
  const [entries, setEntries] = useState<TradeEntry[] | null>(getCachedTradeEntries);
  const [modalState, setModalState] = useState<ModalState>(null);
  const [pendingDelete, setPendingDelete] = useState<TradeEntry | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<TradeEntryStatus | "all">("all");
  const [sideFilter, setSideFilter] = useState<TradeEntrySide | "all">("all");
  const [instrumentFilter, setInstrumentFilter] = useState<Instrument | "all">("all");
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Re-sorting/re-accumulating the whole ledger is wasted work on renders
  // that don't touch `entries` (opening the modal, an import spinner
  // toggling) — memoized so it only re-runs when the entries themselves
  // change, not on every render of this component.
  const rows: BalanceSheetRow[] | null = useMemo(
    () => (entries ? computeBalanceSheetRows(entries) : null),
    [entries],
  );
  const summary = useMemo(() => (entries ? summarizeEntries(entries) : null), [entries]);

  // Search/filter/sort operate on top of the already-computed rows — SL
  // numbering stays tied to the true chronological order (computed above)
  // no matter how the table is currently displayed.
  const displayedRows = useMemo(() => {
    if (!rows) return null;
    let result = rows;

    if (statusFilter !== "all") result = result.filter((r) => r.status === statusFilter);
    if (sideFilter !== "all") result = result.filter((r) => r.side === sideFilter);
    if (instrumentFilter !== "all") result = result.filter((r) => r.instrument === instrumentFilter);

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter((r) => {
        return (
          describeEntryContract(r).toLowerCase().includes(q) ||
          SIDE_LABELS[r.side].toLowerCase().includes(q) ||
          STATUS_LABELS[r.status].toLowerCase().includes(q) ||
          (r.remarks ?? "").toLowerCase().includes(q)
        );
      });
    }

    const dir = sortDir === "asc" ? 1 : -1;
    return [...result].sort((a, b) => {
      switch (sortField) {
        case "pnl":
          return (a.pnl - b.pnl) * dir;
        case "buyPrice":
          return (a.buy_price - b.buy_price) * dir;
        case "sellPrice":
          return (a.sell_price - b.sell_price) * dir;
        case "lots":
          return (a.lots - b.lots) * dir;
        case "date":
        default: {
          if (a.entry_date !== b.entry_date) return (a.entry_date < b.entry_date ? -1 : 1) * dir;
          return (a.created_at < b.created_at ? -1 : 1) * dir;
        }
      }
    });
  }, [rows, statusFilter, sideFilter, instrumentFilter, searchQuery, sortField, sortDir]);

  const hasActiveFilters =
    searchQuery.trim() !== "" || statusFilter !== "all" || sideFilter !== "all" || instrumentFilter !== "all";

  function resetFilters() {
    setSearchQuery("");
    setStatusFilter("all");
    setSideFilter("all");
    setInstrumentFilter("all");
  }

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

  async function handleModalSave(input: AddTradeEntryInput) {
    if (modalState?.mode === "edit") {
      const { entry } = modalState;
      const previous = entries;
      const pnl = calculateEntryPnl(input);

      // Update in place immediately so the row's position never visibly
      // shifts — waiting for the debounced Realtime refetch meant every edit
      // briefly showed the old data, then swapped in a freshly-sorted array
      // all at once, which read as the table reordering even when the sort
      // key (date) hadn't actually changed.
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
        await updateTradeEntry(entry.id, input);
      } catch (err) {
        setEntries(previous);
        throw err;
      }
    } else {
      await addTradeEntry(input);
    }
    setModalState(null);
  }

  function handleModalDelete() {
    if (modalState?.mode !== "edit") return;
    requestDelete(modalState.entry);
  }

  function requestDelete(entry: TradeEntry) {
    setPendingDelete(entry);
  }

  function confirmDelete() {
    if (!pendingDelete) return;
    const entry = pendingDelete;
    setPendingDelete(null);
    setModalState(null);

    const previous = entries;
    setEntries((prev) => (prev ? prev.filter((e) => e.id !== entry.id) : prev));
    deleteTradeEntry(entry.id).catch(() => {
      setEntries(previous);
      showToast("Couldn't delete the entry. Try again.");
    });
  }

  function handleExport() {
    if (!entries || entries.length === 0) {
      showToast("No trade entries to export yet.");
      return;
    }
    downloadJson(`trade-entries-${todayISODate()}.json`, entries);
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
      const result = await importTradeEntries(parsed);
      showToast(`Imported ${result.inserted} new, updated ${result.updated}.`, "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't import — check the file is valid JSON.");
    } finally {
      setImporting(false);
    }
  }

  const statTiles = useMemo(
    () =>
      summary
        ? [
            { label: "Total P&L", value: formatINR(summary.totalPnl), color: pnlColorClass(summary.totalPnl) },
            { label: "Win Rate", value: `${summary.winRatePct.toFixed(0)}%`, color: "" },
            { label: "Total Trades", value: String(summary.totalTrades), color: "" },
            { label: "Avg P&L / Trade", value: formatINR(summary.avgPnl), color: pnlColorClass(summary.avgPnl) },
          ]
        : null,
    [summary],
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Trade Entries</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A daily ledger — instrument, lots, buy/sell price, P&amp;L, and status, all in one
            place.
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
            Add Entry
          </button>
        </div>
      </div>

      {statTiles && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {statTiles.map((stat) => (
            <section key={stat.label} className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <dt className="text-xs text-muted-foreground">{stat.label}</dt>
              <dd className={`mt-1 font-mono text-xl font-semibold tabular-nums ${stat.color}`}>{stat.value}</dd>
            </section>
          ))}
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search instrument, remarks…"
                className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
            </div>
            <div className="w-36 shrink-0">
              <Select value={statusFilter} onChange={setStatusFilter} options={STATUS_FILTER_OPTIONS} />
            </div>
            <div className="w-32 shrink-0">
              <Select value={sideFilter} onChange={setSideFilter} options={SIDE_FILTER_OPTIONS} />
            </div>
            <div className="w-40 shrink-0">
              <Select value={instrumentFilter} onChange={setInstrumentFilter} options={INSTRUMENT_FILTER_OPTIONS} />
            </div>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
              >
                Reset
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sort by</span>
            <div className="w-36 shrink-0">
              <Select value={sortField} onChange={setSortField} options={SORT_FIELD_OPTIONS} />
            </div>
            <button
              type="button"
              onClick={() => setSortDir((prev) => (prev === "asc" ? "desc" : "asc"))}
              aria-label={sortDir === "asc" ? "Ascending — click for descending" : "Descending — click for ascending"}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
            >
              <ArrowUpDownIcon className="size-4" />
              {sortDir === "asc" ? "Ascending" : "Descending"}
            </button>
          </div>
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
          <p className="text-sm text-muted-foreground">No trade entries yet. Add one above to get started.</p>
        </div>
      ) : displayedRows && displayedRows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card p-10 text-center">
          <SearchIcon className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No entries match the current search and filters.</p>
          <button
            type="button"
            onClick={resetFilters}
            className="rounded-lg border border-border px-3.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
          >
            Reset filters
          </button>
        </div>
      ) : (
        <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1020px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left">
                  <th className={`${tableHeadClass} py-3 pl-5 pr-2`}>SL</th>
                  <th className={`${tableHeadClass} px-2 py-3`}>Date</th>
                  <th className={`${tableHeadClass} px-2 py-3`}>Closing Date</th>
                  <th className={`${tableHeadClass} px-2 py-3`}>Instrument</th>
                  <th className={`${tableHeadClass} px-2 py-3`}>Side</th>
                  <th className={`${tableHeadClass} px-2 py-3 text-right`}>Lots</th>
                  <th className={`${tableHeadClass} px-2 py-3 text-right`}>Buy Price</th>
                  <th className={`${tableHeadClass} px-2 py-3 text-right`}>Sell Price</th>
                  <th className={`${tableHeadClass} px-2 py-3 text-right`}>P&amp;L</th>
                  <th className={`${tableHeadClass} px-2 py-3`}>Status</th>
                  <th className={`${tableHeadClass} px-2 py-3`}>Remarks</th>
                  <th className="w-20 py-3 pr-4" />
                </tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {(displayedRows ?? []).map((row) => (
                    <motion.tr
                      key={row.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="border-b border-border last:border-0 hover:bg-muted/30"
                    >
                      <td className="py-2.5 pl-5 pr-2 text-muted-foreground">{row.slNo}</td>
                      <td className="whitespace-nowrap px-2 py-2.5">
                        {formatCellDate(row.entry_date)}
                        <span className="ml-1.5 text-xs text-muted-foreground">{row.day.slice(0, 3)}</span>
                      </td>
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
                        {rupees(row.pnl)}
                      </td>
                      <td className="px-2 py-2.5">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_CLASSES[row.status]}`}
                        >
                          {STATUS_LABELS[row.status]}
                        </span>
                      </td>
                      <td className="max-w-40 truncate px-2 py-2.5 text-muted-foreground">
                        {row.remarks || "—"}
                      </td>
                      <td className="py-2.5 pr-4">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setModalState({ mode: "edit", entry: row })}
                            aria-label={`Edit entry ${row.slNo}`}
                            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/10 hover:text-accent active:scale-90"
                          >
                            <PencilIcon className="size-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => requestDelete(row)}
                            aria-label={`Delete entry ${row.slNo}`}
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

      <AnimatePresence>
        {modalState && (
          <TradeEntryModal
            key={modalState.mode === "edit" ? modalState.entry.id : "new"}
            entry={modalState.mode === "edit" ? modalState.entry : null}
            onSave={handleModalSave}
            onClose={() => setModalState(null)}
            onDelete={handleModalDelete}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {pendingDelete && (
          <ConfirmDialog
            title="Delete this trade entry?"
            message={`${describeEntryContract(pendingDelete)} · ${SIDE_LABELS[pendingDelete.side]} — this can't be undone.`}
            onConfirm={confirmDelete}
            onCancel={() => setPendingDelete(null)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
