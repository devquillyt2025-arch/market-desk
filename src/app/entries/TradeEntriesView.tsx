"use client";

import { useEffect, useState, type FormEvent } from "react";

import { ChevronDownIcon, InboxIcon, PlusIcon, TrashIcon } from "@/components/icons";
import { formatINR } from "@/lib/format";
import { DEFAULT_LOT_SIZES, INSTRUMENT_LABELS, INSTRUMENTS, type Instrument } from "@/lib/types";
import {
  addTradeEntry,
  calculateEntryPnl,
  deleteTradeEntry,
  getTradeEntries,
  setTradeEntryStatus,
  subscribeToTradeEntryChanges,
  TRADE_ENTRY_SIDES,
  TRADE_ENTRY_STATUSES,
  type TradeEntry,
  type TradeEntrySide,
  type TradeEntryStatus,
} from "@/lib/tradeEntriesStore";

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-accent focus:ring-2 focus:ring-accent/30";
const selectClass =
  "w-full appearance-none rounded-lg border border-border bg-background py-2 pl-3 pr-8 text-sm text-foreground outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30";
const labelClass = "text-xs font-medium uppercase tracking-wide text-muted-foreground";
const badgeClass = "rounded-full bg-muted px-2.5 py-1 font-mono text-xs text-muted-foreground";

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

function pnlColorClass(pnl: number): string {
  if (pnl > 0) return "text-profit";
  if (pnl < 0) return "text-loss";
  return "text-foreground";
}

function formatEntryDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function TradeEntriesView() {
  const [entries, setEntries] = useState<TradeEntry[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [entryDate, setEntryDate] = useState(todayISODate());
  const [instrument, setInstrument] = useState<Instrument>("NIFTY");
  const [lots, setLots] = useState(1);
  const [side, setSide] = useState<TradeEntrySide>("sell");
  const [buyPrice, setBuyPrice] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [status, setStatus] = useState<TradeEntryStatus>("hold");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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

  useEffect(() => {
    getTradeEntries().then(setEntries);
    return subscribeToTradeEntryChanges(() => {
      getTradeEntries().then(setEntries);
    });
  }, []);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();

    if (!entryDate) {
      setFormError("Pick a date.");
      return;
    }
    if (!hasValidPrices) {
      setFormError("Enter valid Buy and Sell prices.");
      return;
    }

    setSaving(true);
    try {
      await addTradeEntry({
        entryDate,
        instrument,
        lots,
        side,
        buyPrice: parsedBuyPrice,
        sellPrice: parsedSellPrice,
        status,
      });
      setBuyPrice("");
      setSellPrice("");
      setLots(1);
      setFormError(null);
      setShowForm(false);
    } catch {
      setFormError("Couldn't save the entry. Try again.");
    } finally {
      setSaving(false);
    }
  }

  function handleToggleStatus(entry: TradeEntry) {
    const next: TradeEntryStatus = entry.status === "squared_off" ? "hold" : "squared_off";
    setEntries((prev) => (prev ? prev.map((e) => (e.id === entry.id ? { ...e, status: next } : e)) : prev));
    void setTradeEntryStatus(entry.id, next);
  }

  function handleDelete(entry: TradeEntry) {
    setEntries((prev) => (prev ? prev.filter((e) => e.id !== entry.id) : prev));
    void deleteTradeEntry(entry.id);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Trade Entries</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A daily log — instrument, lots, buy/sell price, and whether it&apos;s squared off or
            still on hold. P&amp;L is calculated for you.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((prev) => !prev)}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
        >
          <PlusIcon className="size-4" />
          Add Entry
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleAdd}
          className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6"
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="entry-instrument" className={labelClass}>
                Instrument
              </label>
              <div className="relative">
                <select
                  id="entry-instrument"
                  value={instrument}
                  onChange={(e) => setInstrument(e.target.value as Instrument)}
                  className={selectClass}
                >
                  {INSTRUMENTS.map((i) => (
                    <option key={i} value={i}>
                      {INSTRUMENT_LABELS[i]}
                    </option>
                  ))}
                </select>
                <ChevronDownIcon className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
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
            <div className="flex flex-col gap-1.5">
              <label htmlFor="entry-side" className={labelClass}>
                Buy / Sell
              </label>
              <div className="relative">
                <select
                  id="entry-side"
                  value={side}
                  onChange={(e) => setSide(e.target.value as TradeEntrySide)}
                  className={selectClass}
                >
                  {TRADE_ENTRY_SIDES.map((s) => (
                    <option key={s} value={s}>
                      {SIDE_LABELS[s]}
                    </option>
                  ))}
                </select>
                <ChevronDownIcon className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
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
            <div className="flex flex-col gap-1.5">
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
            <div className="flex flex-col gap-1.5">
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
            <div className="flex flex-col gap-1.5">
              <label htmlFor="entry-status" className={labelClass}>
                Status
              </label>
              <div className="relative">
                <select
                  id="entry-status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as TradeEntryStatus)}
                  className={selectClass}
                >
                  {TRADE_ENTRY_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
                <ChevronDownIcon className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <span className={labelClass}>P&amp;L</span>
            <span className={`font-mono font-semibold tabular-nums ${previewPnl === null ? "text-muted-foreground" : pnlColorClass(previewPnl)}`}>
              {previewPnl === null ? "—" : formatINR(previewPnl)}
            </span>
            <span className="text-xs text-muted-foreground">
              ({DEFAULT_LOT_SIZES[instrument]} × {lots} lot{lots === 1 ? "" : "s"})
            </span>
          </div>

          {formError && <p className="text-sm text-loss">{formError}</p>}

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save Entry"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setFormError(null);
              }}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {entries === null ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[60px] animate-pulse rounded-xl border border-border bg-card" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card p-10 text-center">
          <InboxIcon className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No trade entries yet. Add one above to get started.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 shadow-sm"
            >
              <span className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-muted-foreground">{formatEntryDate(entry.entry_date)}</span>
                <span className="font-medium">{INSTRUMENT_LABELS[entry.instrument]}</span>
                <span className={badgeClass}>
                  {entry.lots} lot{entry.lots === 1 ? "" : "s"}
                </span>
                <span className={badgeClass}>{SIDE_LABELS[entry.side]}</span>
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  {entry.buy_price.toFixed(2)} → {entry.sell_price.toFixed(2)}
                </span>
                <span className={`font-mono font-semibold tabular-nums ${pnlColorClass(entry.pnl)}`}>
                  {formatINR(entry.pnl)}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleToggleStatus(entry)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-opacity hover:opacity-80 ${STATUS_CLASSES[entry.status]}`}
                >
                  {STATUS_LABELS[entry.status]}
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(entry)}
                  aria-label="Delete entry"
                  className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-loss/10 hover:text-loss"
                >
                  <TrashIcon className="size-4" />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
