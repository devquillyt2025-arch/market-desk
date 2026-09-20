"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";

import {
  ArrowUpDownIcon,
  DownloadIcon,
  InboxIcon,
  PlusIcon,
  SearchIcon,
  UploadIcon,
} from "@/components/icons";
import ConfirmDialog from "@/components/ConfirmDialog";
import LoadingState from "@/components/LoadingState";
import Select from "@/components/Select";
import { computeBalanceSheetRows, type BalanceSheetRow } from "@/lib/calculateBalanceSheet";
import { summarizeEntries } from "@/lib/calculateReports";
import { formatINR, pnlColorClass } from "@/lib/format";
import { PAGE_HEIGHT_LOCK_CLASS } from "@/lib/layout";
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

const badgeClass = "rounded-full border border-border bg-background px-2.5 py-1 font-mono text-xs text-muted-foreground";
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

const STATUS_PILLS: { value: TradeEntryStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "hold", label: "Open" },
  { value: "squared_off", label: "Closed" },
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

/** Persisted so the sort choice survives a refresh instead of resetting to Date/Ascending every time. */
const SORT_STORAGE_KEY = "trade-entries-sort";

function loadStoredSort(): { field: SortField; dir: SortDir } | null {
  try {
    const raw = localStorage.getItem(SORT_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const { field, dir } = parsed as Record<string, unknown>;
    if (
      typeof field === "string" &&
      SORT_FIELD_OPTIONS.some((o) => o.value === field) &&
      (dir === "asc" || dir === "desc")
    ) {
      return { field: field as SortField, dir };
    }
    return null;
  } catch {
    return null;
  }
}

function sortRows(rows: BalanceSheetRow[], field: SortField, dir: SortDir): BalanceSheetRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    switch (field) {
      case "pnl":
        return (a.pnl - b.pnl) * sign;
      case "buyPrice":
        return (a.buy_price - b.buy_price) * sign;
      case "sellPrice":
        return (a.sell_price - b.sell_price) * sign;
      case "lots":
        return (a.lots - b.lots) * sign;
      case "date":
      default: {
        if (a.entry_date !== b.entry_date) return (a.entry_date < b.entry_date ? -1 : 1) * sign;
        return (a.created_at < b.created_at ? -1 : 1) * sign;
      }
    }
  });
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
  const [sortHydrated, setSortHydrated] = useState(false);

  useEffect(() => {
    const stored = loadStoredSort();
    if (stored) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSortField(stored.field);
      setSortDir(stored.dir);
    }
    setSortHydrated(true);
  }, []);

  useEffect(() => {
    if (!sortHydrated) return;
    try {
      localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify({ field: sortField, dir: sortDir }));
    } catch {
      // localStorage may be unavailable; the choice just won't persist for this load.
    }
  }, [sortField, sortDir, sortHydrated]);

  // Re-sorting/re-accumulating the whole ledger is wasted work on renders
  // that don't touch `entries` (opening the modal, an import spinner
  // toggling) — memoized so it only re-runs when the entries themselves
  // change, not on every render of this component.
  const rows: BalanceSheetRow[] | null = useMemo(
    () => (entries ? computeBalanceSheetRows(entries) : null),
    [entries],
  );
  const summary = useMemo(() => (entries ? summarizeEntries(entries) : null), [entries]);

  const statusCounts = useMemo(() => {
    if (!rows) return null;
    let open = 0;
    let closed = 0;
    for (const r of rows) {
      if (r.status === "hold") open += 1;
      else closed += 1;
    }
    return { all: rows.length, hold: open, squared_off: closed };
  }, [rows]);

  // The row *order* is frozen independent of the rows' own field values —
  // recomputed only when the sort control changes or the set of ids itself
  // changes (an add/delete), never merely because an edit changed some
  // row's value. Without this, editing (say) the 4th row while sorted by
  // P&L would immediately jump it to wherever its new P&L now sorts to;
  // sorting is a one-time action here, not a live constraint re-applied on
  // every keystroke of an edit.
  const rowIdsSignature = useMemo(() => (rows ? rows.map((r) => r.id).sort().join(",") : ""), [rows]);
  const orderedIds = useMemo(() => {
    if (!rows) return [];
    return sortRows(rows, sortField, sortDir).map((r) => r.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rowIdsSignature (not `rows`) is the real dependency: it only changes when a row is added/removed, not when an existing row's fields are edited, which is what keeps this memo from recomputing (and reordering the table) on every edit.
  }, [rowIdsSignature, sortField, sortDir]);

  // Filters stay live (always reflect the latest field values) on top of
  // that frozen order — only which rows qualify can change on an edit,
  // never their relative position. SL is renumbered fresh from whatever
  // ends up on screen, so it always reads 1..N top-to-bottom rather than
  // the chronological numbering `rows` carries.
  const displayedRows = useMemo(() => {
    if (!rows) return null;
    const byId = new Map(rows.map((r) => [r.id, r]));
    const orderedIdSet = new Set(orderedIds);
    // orderedIds is recomputed in the same render whenever the id set
    // changes, so this should never actually find anything — a defensive
    // fallback rather than something expected to trigger.
    let result = [
      ...orderedIds.map((id) => byId.get(id)).filter((r): r is BalanceSheetRow => Boolean(r)),
      ...rows.filter((r) => !orderedIdSet.has(r.id)),
    ];

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

    return result.map((row, index) => ({ ...row, slNo: index + 1 }));
  }, [rows, orderedIds, statusFilter, sideFilter, instrumentFilter, searchQuery]);

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
      // Locks the page to the viewport so the table below can flex-fill the
      // remaining space and scroll internally instead of growing the whole
      // page — only the table body should scroll, not <main>.
      className={`flex flex-col gap-6 ${PAGE_HEIGHT_LOCK_CLASS}`}
    >
      <div className="shrink-0 flex flex-wrap items-start justify-between gap-3">
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
        <div className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-4">
          {statTiles.map((stat) => (
            <section key={stat.label} className="rounded-xl border border-border bg-background p-4">
              <dt className="text-xs text-muted-foreground">{stat.label}</dt>
              <dd className={`mt-1 font-mono text-xl font-semibold tabular-nums ${stat.color}`}>{stat.value}</dd>
            </section>
          ))}
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <div className="relative w-32 shrink-0 sm:w-48">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search…"
              className="w-full rounded-lg border border-border bg-card py-2 pl-8 pr-2 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-accent focus:ring-2 focus:ring-accent/30"
            />
          </div>
          <div className="flex w-fit shrink-0 items-center gap-1 rounded-full border border-border bg-background p-1">
            {STATUS_PILLS.map((opt) => {
              const active = statusFilter === opt.value;
              const count = statusCounts?.[opt.value] ?? 0;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setStatusFilter(opt.value)}
                  aria-pressed={active}
                  className={`relative flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors active:scale-95 ${
                    active ? "text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="status-pill-active"
                      className="absolute inset-0 rounded-full bg-accent"
                      transition={{ type: "spring", stiffness: 500, damping: 35 }}
                    />
                  )}
                  <span className="relative z-10">{opt.label}</span>
                  <span
                    className={`relative z-10 font-mono text-xs tabular-nums ${
                      active ? "text-accent-foreground/80" : "text-muted-foreground/70"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
          <span className="shrink-0 whitespace-nowrap text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Sort by
          </span>
          <div className="w-28 shrink-0 sm:w-36">
            <Select value={sortField} onChange={setSortField} options={SORT_FIELD_OPTIONS} />
          </div>
          <button
            type="button"
            onClick={() => setSortDir((prev) => (prev === "asc" ? "desc" : "asc"))}
            aria-label={sortDir === "asc" ? "Ascending — click for descending" : "Descending — click for ascending"}
            title={sortDir === "asc" ? "Ascending" : "Descending"}
            className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-border px-2.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
          >
            <ArrowUpDownIcon className="size-4" />
            {sortDir === "asc" ? "Asc" : "Desc"}
          </button>
          <div className="w-28 shrink-0 sm:w-32">
            <Select value={sideFilter} onChange={setSideFilter} options={SIDE_FILTER_OPTIONS} />
          </div>
          <div className="w-32 shrink-0 sm:w-40">
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
      )}

      <div className="min-h-0 flex-1">
        {rows === null ? (
          <LoadingState className="h-40" label="Loading trade entries…" />
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-background p-10 text-center">
            <InboxIcon className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No trade entries yet. Add one above to get started.</p>
          </div>
        ) : displayedRows && displayedRows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-background p-10 text-center">
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
          <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-background">
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-[1020px] border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-background">
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
                    <th className={`${tableHeadClass} px-2 py-3`}>Status</th>
                    <th className={`${tableHeadClass} px-2 py-3`}>Remarks</th>
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
                        onClick={() => setModalState({ mode: "edit", entry: row })}
                        className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/30"
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
