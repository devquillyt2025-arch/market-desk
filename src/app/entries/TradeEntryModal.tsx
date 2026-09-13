"use client";

import { motion } from "framer-motion";
import { useState } from "react";

import { TrashIcon, XIcon } from "@/components/icons";
import Select from "@/components/Select";
import { formatINR, pnlColorClass } from "@/lib/format";
import { DEFAULT_LOT_SIZES, INSTRUMENT_LABELS, INSTRUMENTS, type Instrument } from "@/lib/types";
import {
  calculateEntryPnl,
  TRADE_ENTRY_OPTION_TYPES,
  TRADE_ENTRY_SIDES,
  TRADE_ENTRY_STATUSES,
  type AddTradeEntryInput,
  type TradeEntry,
  type TradeEntryOptionType,
  type TradeEntrySide,
  type TradeEntryStatus,
} from "@/lib/tradeEntriesStore";

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-accent focus:ring-2 focus:ring-accent/30";
const selectTriggerClass =
  "flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30";
const labelClass = "text-xs font-medium uppercase tracking-wide text-muted-foreground";

const STATUS_LABELS: Record<TradeEntryStatus, string> = {
  squared_off: "Squared Off",
  hold: "Hold",
};

const SIDE_LABELS: Record<TradeEntrySide, string> = {
  buy: "Buy",
  sell: "Sell",
};

const INSTRUMENT_OPTIONS = INSTRUMENTS.map((i) => ({ value: i, label: INSTRUMENT_LABELS[i] }));
const SIDE_OPTIONS = TRADE_ENTRY_SIDES.map((s) => ({ value: s, label: SIDE_LABELS[s] }));
const STATUS_OPTIONS = TRADE_ENTRY_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }));
/** "" means "not an options trade" — Strike Price/CE-PE are optional, unlike the other fields. */
const OPTION_TYPE_OPTIONS = [
  { value: "" as const, label: "—" },
  ...TRADE_ENTRY_OPTION_TYPES.map((t) => ({ value: t, label: t })),
];

function todayISODate(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

type TradeEntryModalProps = {
  /** null = creating a new entry; otherwise the entry being edited. */
  entry: TradeEntry | null;
  onSave: (input: AddTradeEntryInput) => Promise<void>;
  onClose: () => void;
  onDelete: () => void;
};

export default function TradeEntryModal({ entry, onSave, onClose, onDelete }: TradeEntryModalProps) {
  const [entryDate, setEntryDate] = useState(entry?.entry_date ?? todayISODate());
  const [instrument, setInstrument] = useState<Instrument>(entry?.instrument ?? "NIFTY");
  const [strikePrice, setStrikePrice] = useState(entry?.strike_price != null ? String(entry.strike_price) : "");
  const [optionType, setOptionType] = useState<TradeEntryOptionType | "">(entry?.option_type ?? "");
  const [lots, setLots] = useState(entry?.lots ?? 1);
  const [side, setSide] = useState<TradeEntrySide>(entry?.side ?? "sell");
  const [buyPrice, setBuyPrice] = useState(entry ? String(entry.buy_price) : "");
  const [sellPrice, setSellPrice] = useState(entry ? String(entry.sell_price) : "");
  const [status, setStatus] = useState<TradeEntryStatus>(entry?.status ?? "hold");
  const [remarks, setRemarks] = useState(entry?.remarks ?? "");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const parsedBuyPrice = Number(buyPrice);
  const parsedSellPrice = Number(sellPrice);
  const hasValidPrices =
    buyPrice.trim() !== "" &&
    sellPrice.trim() !== "" &&
    Number.isFinite(parsedBuyPrice) &&
    Number.isFinite(parsedSellPrice);
  const parsedStrikePrice = Number(strikePrice);
  const hasStrikeMismatch =
    (strikePrice.trim() !== "" && optionType === "") || (strikePrice.trim() === "" && optionType !== "");
  const previewPnl = hasValidPrices
    ? calculateEntryPnl({ instrument, lots, buyPrice: parsedBuyPrice, sellPrice: parsedSellPrice })
    : null;

  async function handleSave() {
    if (!entryDate) {
      setFormError("Pick a date.");
      return;
    }
    if (!hasValidPrices) {
      setFormError("Enter valid Buy and Sell prices.");
      return;
    }
    if (hasStrikeMismatch) {
      setFormError("Enter both Strike Price and CE/PE, or leave both blank.");
      return;
    }
    if (strikePrice.trim() !== "" && !Number.isFinite(parsedStrikePrice)) {
      setFormError("Enter a valid strike price.");
      return;
    }

    setSaving(true);
    try {
      await onSave({
        entryDate,
        instrument,
        strikePrice: strikePrice.trim() !== "" ? parsedStrikePrice : undefined,
        optionType: optionType || undefined,
        lots,
        side,
        buyPrice: parsedBuyPrice,
        sellPrice: parsedSellPrice,
        status,
        remarks: remarks || undefined,
      });
    } catch {
      setFormError(entry ? "Couldn't save changes. Try again." : "Couldn't save the entry. Try again.");
      setSaving(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold tracking-tight">{entry ? "Edit Trade Entry" : "Add Trade Entry"}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <XIcon className="size-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4 p-6">
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
              <label htmlFor="entry-strike" className={labelClass}>
                Strike Price
              </label>
              <input
                id="entry-strike"
                type="number"
                step="1"
                value={strikePrice}
                onChange={(e) => setStrikePrice(e.target.value)}
                placeholder="e.g. 23500"
                className={`${inputClass} font-mono tabular-nums`}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="entry-option-type" className={labelClass}>
                CE / PE
              </label>
              <Select
                id="entry-option-type"
                value={optionType}
                onChange={setOptionType}
                options={OPTION_TYPE_OPTIONS}
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
            <div className="flex flex-col gap-1 sm:col-span-3">
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

          {formError && <p className="text-sm text-loss">{formError}</p>}
        </div>

        <div className="sticky bottom-0 flex shrink-0 items-center justify-between border-t border-border bg-card p-4">
          {entry ? (
            <button
              type="button"
              onClick={onDelete}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-loss transition-colors hover:bg-loss/10"
            >
              <TrashIcon className="size-4" />
              Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-60 active:scale-95"
            >
              {saving ? "Saving…" : entry ? "Save Changes" : "Save Entry"}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
