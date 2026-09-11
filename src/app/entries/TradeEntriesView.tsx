"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState, type FormEvent } from "react";

import { CheckIcon, InboxIcon, PencilIcon, PlusIcon, TrashIcon, XIcon } from "@/components/icons";
import Select from "@/components/Select";
import { computeBalanceSheetRows, type BalanceSheetRow } from "@/lib/calculateBalanceSheet";
import { formatINR, pnlColorClass } from "@/lib/format";
import { showToast } from "@/lib/toast";
import { DEFAULT_LOT_SIZES, INSTRUMENT_LABELS, INSTRUMENTS, type Instrument } from "@/lib/types";
import {
  addTradeEntry,
  calculateEntryPnl,
  deleteTradeEntry,
  getCachedStartingFund,
  getCachedTradeEntries,
  getStartingFund,
  getTradeEntries,
  setTradeEntryStatus,
  subscribeToTradeEntryChanges,
  TRADE_ENTRY_SIDES,
  TRADE_ENTRY_STATUSES,
  updateStartingFund,
  updateTradeEntry,
  type AddTradeEntryInput,
  type TradeEntry,
  type TradeEntrySide,
  type TradeEntryStatus,
} from "@/lib/tradeEntriesStore";

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-accent focus:ring-2 focus:ring-accent/30";
const selectTriggerClass =
  "flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30";
const labelClass = "text-xs font-medium uppercase tracking-wide text-muted-foreground";
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

const INSTRUMENT_OPTIONS = INSTRUMENTS.map((i) => ({ value: i, label: INSTRUMENT_LABELS[i] }));
const SIDE_OPTIONS = TRADE_ENTRY_SIDES.map((s) => ({ value: s, label: SIDE_LABELS[s] }));
const STATUS_OPTIONS = TRADE_ENTRY_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }));

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

export default function TradeEntriesView() {
  const [entries, setEntries] = useState<TradeEntry[] | null>(getCachedTradeEntries);
  const [startingFund, setStartingFund] = useState<number | null>(getCachedStartingFund);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [entryDate, setEntryDate] = useState(todayISODate());
  const [instrument, setInstrument] = useState<Instrument>("NIFTY");
  const [lots, setLots] = useState(1);
  const [side, setSide] = useState<TradeEntrySide>("sell");
  const [buyPrice, setBuyPrice] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [status, setStatus] = useState<TradeEntryStatus>("hold");
  const [remarks, setRemarks] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [editingFund, setEditingFund] = useState(false);
  const [fundInput, setFundInput] = useState("");
  const [savingFund, setSavingFund] = useState(false);

  const parsedBuyPrice = Number(buyPrice);
  const parsedSellPrice = Number(sellPrice);
  const hasValidPrices =
    buyPrice.trim() !== "" &&
    sellPrice.trim() !== "" &&
    Number.isFinite(parsedBuyPrice) &&
    Number.isFinite(parsedSellPrice);
  const previewPnl = hasValidPrices
    ? calculateEntryPnl({ instrument, lots, buyPrice: parsedBuyPrice, sellPrice: parsedSellPrice })
    : null;

  const rows: BalanceSheetRow[] | null =
    entries && startingFund !== null ? computeBalanceSheetRows(entries, startingFund) : null;

  useEffect(() => {
    async function load() {
      try {
        const [nextEntries, nextFund] = await Promise.all([getTradeEntries(), getStartingFund()]);
        setEntries(nextEntries);
        setStartingFund(nextFund);
      } catch {
        showToast("Couldn't load trade entries. Check your connection.");
      }
    }
    load();
    return subscribeToTradeEntryChanges(load);
  }, []);

  function resetFormFields() {
    setEntryDate(todayISODate());
    setInstrument("NIFTY");
    setLots(1);
    setSide("sell");
    setBuyPrice("");
    setSellPrice("");
    setStatus("hold");
    setRemarks("");
    setFormError(null);
    setEditingId(null);
  }

  function openAddForm() {
    resetFormFields();
    setShowForm(true);
  }

  function openEditForm(entry: TradeEntry) {
    setEditingId(entry.id);
    setEntryDate(entry.entry_date);
    setInstrument(entry.instrument);
    setLots(entry.lots);
    setSide(entry.side);
    setBuyPrice(String(entry.buy_price));
    setSellPrice(String(entry.sell_price));
    setStatus(entry.status);
    setRemarks(entry.remarks ?? "");
    setFormError(null);
    setShowForm(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!entryDate) {
      setFormError("Pick a date.");
      return;
    }
    if (!hasValidPrices) {
      setFormError("Enter valid Buy and Sell prices.");
      return;
    }

    const payload: AddTradeEntryInput = {
      entryDate,
      instrument,
      lots,
      side,
      buyPrice: parsedBuyPrice,
      sellPrice: parsedSellPrice,
      status,
      remarks: remarks || undefined,
    };

    setSaving(true);
    try {
      if (editingId) {
        await updateTradeEntry(editingId, payload);
      } else {
        await addTradeEntry(payload);
      }
      resetFormFields();
      setShowForm(false);
    } catch {
      setFormError(editingId ? "Couldn't save changes. Try again." : "Couldn't save the entry. Try again.");
    } finally {
      setSaving(false);
    }
  }

  function handleToggleStatus(entry: TradeEntry) {
    const previous = entries;
    const next: TradeEntryStatus = entry.status === "squared_off" ? "hold" : "squared_off";
    setEntries((prev) => (prev ? prev.map((e) => (e.id === entry.id ? { ...e, status: next } : e)) : prev));
    setTradeEntryStatus(entry.id, next).catch(() => {
      setEntries(previous);
      showToast("Couldn't update the status. Try again.");
    });
  }

  function handleDelete(entry: TradeEntry) {
    const previous = entries;
    setEntries((prev) => (prev ? prev.filter((e) => e.id !== entry.id) : prev));
    deleteTradeEntry(entry.id).catch(() => {
      setEntries(previous);
      showToast("Couldn't delete the entry. Try again.");
    });
  }

  function startEditingFund() {
    setFundInput(String(startingFund ?? 0));
    setEditingFund(true);
  }

  async function handleSaveFund() {
    const parsed = Number(fundInput);
    if (!Number.isFinite(parsed)) {
      showToast("Enter a valid starting fund amount.");
      return;
    }
    const previous = startingFund;
    setSavingFund(true);
    setStartingFund(parsed);
    try {
      await updateStartingFund(parsed);
      setEditingFund(false);
    } catch {
      setStartingFund(previous);
      showToast("Couldn't update the starting fund. Try again.");
    } finally {
      setSavingFund(false);
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
          <h1 className="text-2xl font-semibold tracking-tight">Trade Entries</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A daily ledger — instrument, lots, buy/sell price, status, and the running balance
            sheet, all in one place.
          </p>
        </div>
        <button
          type="button"
          onClick={openAddForm}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 active:scale-95"
        >
          <PlusIcon className="size-4" />
          Add Entry
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
        <dt className="text-xs text-muted-foreground">Starting Fund</dt>
        {editingFund ? (
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.01"
              autoFocus
              value={fundInput}
              onChange={(e) => setFundInput(e.target.value)}
              className={`${inputClass} max-w-40 font-mono tabular-nums`}
            />
            <button
              type="button"
              onClick={handleSaveFund}
              disabled={savingFund}
              aria-label="Save starting fund"
              className="flex size-8 items-center justify-center rounded-md text-profit transition-colors hover:bg-profit/10 disabled:opacity-50"
            >
              <CheckIcon className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setEditingFund(false)}
              aria-label="Cancel"
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted"
            >
              <XIcon className="size-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={startEditingFund}
            className="flex items-center gap-2 font-mono text-lg font-semibold tabular-nums transition-opacity hover:opacity-80"
          >
            {rupees(startingFund ?? 0)}
            <PencilIcon className="size-3.5 text-muted-foreground" />
          </button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {showForm && (
          <motion.form
            key="entry-form"
            onSubmit={handleSubmit}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-col gap-3 overflow-hidden rounded-xl border border-border bg-card p-4 shadow-sm"
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="flex flex-col gap-1">
                <label htmlFor="entry-instrument" className={labelClass}>
                  Instrument
                </label>
                <Select
                  id="entry-instrument"
                  value={instrument}
                  onChange={setInstrument}
                  options={INSTRUMENT_OPTIONS}
                  triggerClassName={selectTriggerClass}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="entry-side" className={labelClass}>
                  Buy / Sell
                </label>
                <Select
                  id="entry-side"
                  value={side}
                  onChange={setSide}
                  options={SIDE_OPTIONS}
                  triggerClassName={selectTriggerClass}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="entry-lots" className={labelClass}>
                  Lots
                </label>
                <input
                  id="entry-lots"
                  type="number"
                  min={1}
                  step={1}
                  value={lots}
                  onChange={(e) => setLots(Math.max(1, Math.trunc(Number(e.target.value)) || 1))}
                  className={`${inputClass} font-mono tabular-nums`}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="entry-date" className={labelClass}>
                  Date
                </label>
                <input
                  id="entry-date"
                  type="date"
                  value={entryDate}
                  onChange={(e) => setEntryDate(e.target.value)}
                  className={`${inputClass} font-mono tabular-nums`}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="entry-buy-price" className={labelClass}>
                  Buy Price
                </label>
                <input
                  id="entry-buy-price"
                  type="number"
                  step="0.01"
                  value={buyPrice}
                  onChange={(e) => setBuyPrice(e.target.value)}
                  placeholder="e.g. 120.50"
                  className={`${inputClass} font-mono tabular-nums`}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="entry-sell-price" className={labelClass}>
                  Sell Price
                </label>
                <input
                  id="entry-sell-price"
                  type="number"
                  step="0.01"
                  value={sellPrice}
                  onChange={(e) => setSellPrice(e.target.value)}
                  placeholder="e.g. 145.75"
                  className={`${inputClass} font-mono tabular-nums`}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="entry-status" className={labelClass}>
                  Status
                </label>
                <Select
                  id="entry-status"
                  value={status}
                  onChange={setStatus}
                  options={STATUS_OPTIONS}
                  triggerClassName={selectTriggerClass}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="entry-remarks" className={labelClass}>
                  Remarks
                </label>
                <input
                  id="entry-remarks"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Optional"
                  className={inputClass}
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm">
                <span className={labelClass}>P&amp;L</span>
                <span
                  className={`font-mono font-semibold tabular-nums ${previewPnl === null ? "text-muted-foreground" : pnlColorClass(previewPnl)}`}
                >
                  {previewPnl === null ? "—" : formatINR(previewPnl)}
                </span>
                <span className="text-xs text-muted-foreground">
                  ({DEFAULT_LOT_SIZES[instrument]} × {lots} lot{lots === 1 ? "" : "s"})
                </span>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    resetFormFields();
                    setShowForm(false);
                  }}
                  className="rounded-lg border border-border px-3.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-accent px-3.5 py-1.5 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-60 active:scale-95"
                >
                  {saving ? "Saving…" : editingId ? "Save Changes" : "Save Entry"}
                </button>
              </div>
            </div>

            {formError && <p className="text-sm text-loss">{formError}</p>}
          </motion.form>
        )}
      </AnimatePresence>

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
      ) : (
        <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left">
                  <th className={`${tableHeadClass} py-3 pl-5 pr-2`}>SL</th>
                  <th className={`${tableHeadClass} px-2 py-3`}>Date</th>
                  <th className={`${tableHeadClass} px-2 py-3`}>Instrument</th>
                  <th className={`${tableHeadClass} px-2 py-3`}>Side</th>
                  <th className={`${tableHeadClass} px-2 py-3 text-right`}>Lots</th>
                  <th className={`${tableHeadClass} px-2 py-3 text-right`}>Buy Price</th>
                  <th className={`${tableHeadClass} px-2 py-3 text-right`}>Sell Price</th>
                  <th className={`${tableHeadClass} px-2 py-3 text-right`}>Closing Bal</th>
                  <th className={`${tableHeadClass} px-2 py-3 text-right`}>PNL(K)</th>
                  <th className={`${tableHeadClass} px-2 py-3 text-right`}>Fund</th>
                  <th className={`${tableHeadClass} px-2 py-3`}>Status</th>
                  <th className={`${tableHeadClass} px-2 py-3`}>Remarks</th>
                  <th className="w-20 py-3 pr-4" />
                </tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {rows.map((row) => (
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
                      <td className="px-2 py-2.5 font-medium">{INSTRUMENT_LABELS[row.instrument]}</td>
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
                        className={`whitespace-nowrap px-2 py-2.5 text-right font-mono font-medium tabular-nums ${pnlColorClass(row.closingBalance)}`}
                      >
                        {rupees(row.closingBalance)}
                      </td>
                      <td
                        className={`whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums ${pnlColorClass(row.pnlK)}`}
                      >
                        {row.pnlK.toFixed(2)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums">
                        {rupees(row.fund)}
                      </td>
                      <td className="px-2 py-2.5">
                        <button
                          type="button"
                          onClick={() => handleToggleStatus(row)}
                          className={`rounded-full px-3 py-1 text-xs font-medium transition-opacity hover:opacity-80 active:scale-95 ${STATUS_CLASSES[row.status]}`}
                        >
                          {STATUS_LABELS[row.status]}
                        </button>
                      </td>
                      <td className="max-w-40 truncate px-2 py-2.5 text-muted-foreground">
                        {row.remarks || "—"}
                      </td>
                      <td className="py-2.5 pr-4">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => openEditForm(row)}
                            aria-label={`Edit entry ${row.slNo}`}
                            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/10 hover:text-accent active:scale-90"
                          >
                            <PencilIcon className="size-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(row)}
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
    </motion.div>
  );
}
