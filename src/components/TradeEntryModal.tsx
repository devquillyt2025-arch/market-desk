"use client";

import { motion } from "framer-motion";
import { useState } from "react";

import DatePicker from "@/components/DatePicker";
import { TrashIcon, XIcon } from "@/components/icons";
import Select from "@/components/Select";
import type { LivePositionInfo } from "@/lib/calculatePortfolio";
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
  "w-full rounded-lg border border-border bg-card px-3 py-1.5 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-accent focus:ring-2 focus:ring-accent/30";
const selectTriggerClass =
  "flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30";
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

/** Marks a price field that's currently following the live LTP instead of holding a typed value. */
function LiveTag() {
  return (
    <span className="ml-1.5 inline-flex items-center gap-1 text-[10px] font-semibold normal-case tracking-normal text-profit">
      <span className="size-1.5 animate-pulse rounded-full bg-profit" aria-hidden="true" />
      live
    </span>
  );
}

function formatGreek(value: number | null, decimals: number): string {
  return value == null ? "—" : value.toFixed(decimals);
}

function formatOi(value: number | null): string {
  return value == null ? "—" : value.toLocaleString("en-IN");
}

type TradeEntryModalProps = {
  /** null = creating a new entry; otherwise the entry being edited. */
  entry: TradeEntry | null;
  onSave: (input: AddTradeEntryInput) => Promise<void>;
  onClose: () => void;
  onDelete: () => void;
  /** Shared with Paper Trade, which passes "Paper Trade" so the heading doesn't say "Trade Entry" on that page. */
  entityLabel?: string;
  /**
   * Only set when opened from Live Portfolio's/Paper Trade's Open Positions
   * table — closed positions and plain Trade Entries have no live data. The
   * caller re-derives this from the latest poll on every render (not a
   * snapshot taken at click time), so these figures keep matching the row
   * behind the popup.
   */
  live?: LivePositionInfo | null;
};

export default function TradeEntryModal({
  entry,
  onSave,
  onClose,
  onDelete,
  entityLabel = "Trade Entry",
  live,
}: TradeEntryModalProps) {
  const [entryDate, setEntryDate] = useState(entry?.entry_date ?? todayISODate());
  const [instrument, setInstrument] = useState<Instrument>(entry?.instrument ?? "NIFTY");
  const [strikePrice, setStrikePrice] = useState(entry?.strike_price != null ? String(entry.strike_price) : "");
  const [optionType, setOptionType] = useState<TradeEntryOptionType | "">(entry?.option_type ?? "");
  const [expiryDate, setExpiryDate] = useState(entry?.expiry_date ?? "");
  const [closingDate, setClosingDate] = useState(entry?.closing_date ?? "");
  const [lots, setLots] = useState(entry?.lots ?? 1);
  const [side, setSide] = useState<TradeEntrySide>(entry?.side ?? "sell");
  const [buyPrice, setBuyPrice] = useState(entry ? String(entry.buy_price) : "");
  const [sellPrice, setSellPrice] = useState(entry ? String(entry.sell_price) : "");
  const [status, setStatus] = useState<TradeEntryStatus>(entry?.status ?? "hold");
  // True once the user types over the un-executed leg's price themselves — from then on it stops following the live LTP.
  const [pendingLegTouched, setPendingLegTouched] = useState(false);
  const [remarks, setRemarks] = useState(entry?.remarks ?? "");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // An open position's un-executed leg — the buy-back for a short, the
  // sell-to-close for a long — isn't a real price yet, it's whatever the
  // market says right now. While the position is still on Hold and the user
  // hasn't overridden it, that field shows (and saves) the live LTP, the
  // same substitution the table row makes, so this form's P&L is the row's
  // Live P&L instead of a stale hand-typed placeholder.
  const liveLtp = live?.ltp ?? null;
  const followingLive = status === "hold" && liveLtp != null && !pendingLegTouched;
  const followBuy = followingLive && side === "sell";
  const followSell = followingLive && side === "buy";
  const shownBuyPrice = followBuy ? liveLtp.toFixed(2) : buyPrice;
  const shownSellPrice = followSell ? liveLtp.toFixed(2) : sellPrice;

  function handleStatusChange(next: TradeEntryStatus) {
    // Leaving Hold freezes the followed field at its current value, so the
    // price doesn't keep drifting under a position being closed out.
    if (next !== "hold" && liveLtp != null) {
      if (followBuy) setBuyPrice(liveLtp.toFixed(2));
      if (followSell) setSellPrice(liveLtp.toFixed(2));
    }
    setStatus(next);
  }

  const parsedBuyPrice = Number(shownBuyPrice);
  const parsedSellPrice = Number(shownSellPrice);
  const hasValidPrices =
    shownBuyPrice.trim() !== "" &&
    shownSellPrice.trim() !== "" &&
    Number.isFinite(parsedBuyPrice) &&
    Number.isFinite(parsedSellPrice);
  const parsedStrikePrice = Number(strikePrice);
  // Strike/CE-PE/Expiry travel together — either all three are set (an
  // options contract Live Portfolio can track) or none are (a non-options
  // entry), never a partial combination.
  const contractFieldsFilled = [strikePrice.trim() !== "", optionType !== "", expiryDate.trim() !== ""];
  const hasStrikeMismatch = contractFieldsFilled.some(Boolean) && !contractFieldsFilled.every(Boolean);
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
      setFormError("Enter Strike Price, CE/PE, and Expiry Date together, or leave all three blank.");
      return;
    }
    if (strikePrice.trim() !== "" && !Number.isFinite(parsedStrikePrice)) {
      setFormError("Enter a valid strike price.");
      return;
    }
    if (status === "squared_off" && !closingDate.trim()) {
      // Reports keys realized P&L off closing_date (see calculateReports.ts)
      // — a squared-off entry with no closing date would silently vanish
      // from the P&L calendar and account growth chart.
      setFormError("Pick a Closing Date for a squared-off entry.");
      return;
    }

    setSaving(true);
    try {
      await onSave({
        entryDate,
        instrument,
        strikePrice: strikePrice.trim() !== "" ? parsedStrikePrice : undefined,
        optionType: optionType || undefined,
        expiryDate: expiryDate.trim() || undefined,
        closingDate: closingDate.trim() || undefined,
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
      transition={{ duration: 0.12 }}
      className="glass-backdrop fixed inset-0 z-[300] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: -4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: -4, transition: { duration: 0.12, ease: "easeIn" } }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        onClick={(e) => e.stopPropagation()}
        className="glass-panel flex max-h-[88vh] w-full max-w-2xl flex-col overflow-y-auto"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold tracking-tight">
            {entry ? `Edit ${entityLabel}` : `Add ${entityLabel}`}
          </h2>
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
              <label htmlFor="entry-expiry" className={labelClass}>
                Expiry Date
              </label>
              <DatePicker id="entry-expiry" value={expiryDate} onChange={setExpiryDate} clearable />
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
              <DatePicker id="entry-date" value={entryDate} onChange={setEntryDate} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="entry-closing-date" className={labelClass}>
                Closing Date
              </label>
              <DatePicker id="entry-closing-date" value={closingDate} onChange={setClosingDate} clearable />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="entry-buy-price" className={labelClass}>
                Buy Price
                {followBuy && <LiveTag />}
              </label>
              <input
                id="entry-buy-price"
                type="number"
                step="0.01"
                value={shownBuyPrice}
                onChange={(e) => {
                  setBuyPrice(e.target.value);
                  if (side === "sell") setPendingLegTouched(true);
                }}
                placeholder="e.g. 120.50"
                className={`${inputClass} font-mono tabular-nums`}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="entry-sell-price" className={labelClass}>
                Sell Price
                {followSell && <LiveTag />}
              </label>
              <input
                id="entry-sell-price"
                type="number"
                step="0.01"
                value={shownSellPrice}
                onChange={(e) => {
                  setSellPrice(e.target.value);
                  if (side === "buy") setPendingLegTouched(true);
                }}
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
                onChange={handleStatusChange}
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

          {live && (
            <div className="rounded-lg border border-border bg-bg-surface-alt p-3">
              <div className="flex items-center gap-2">
                <p className={labelClass}>Live</p>
                <span className="size-1.5 animate-pulse rounded-full bg-profit" aria-hidden="true" />
              </div>
              <div className="mt-2 grid grid-cols-3 gap-3">
                <div>
                  <dt className="text-[11px] text-muted-foreground">LTP</dt>
                  <dd className="font-mono text-base font-semibold tabular-nums">
                    {live.ltp == null ? "—" : live.ltp.toFixed(2)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-muted-foreground">Live P&amp;L</dt>
                  <dd
                    className={`font-mono text-base font-semibold tabular-nums ${
                      live.pnl == null ? "text-muted-foreground" : pnlColorClass(live.pnl)
                    }`}
                  >
                    {live.pnl == null ? "—" : formatINR(live.pnl)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-muted-foreground">Brokerage if closed</dt>
                  <dd className="font-mono text-base tabular-nums text-muted-foreground">
                    {live.brokerageIfClosed == null ? "—" : formatINR(live.brokerageIfClosed)}
                  </dd>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-3 border-t border-border pt-3 sm:grid-cols-5">
                <div>
                  <dt className="text-[11px] text-muted-foreground">Delta</dt>
                  <dd className="font-mono text-sm tabular-nums">{formatGreek(live.delta, 3)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-muted-foreground">Gamma</dt>
                  <dd className="font-mono text-sm tabular-nums">{formatGreek(live.gamma, 4)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-muted-foreground">Theta</dt>
                  <dd className="font-mono text-sm tabular-nums">{formatGreek(live.theta, 2)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-muted-foreground">Vega</dt>
                  <dd className="font-mono text-sm tabular-nums">{formatGreek(live.vega, 2)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-muted-foreground">OI</dt>
                  <dd className="font-mono text-sm tabular-nums">{formatOi(live.oi)}</dd>
                </div>
              </div>
            </div>
          )}

          {formError && <p className="text-sm text-loss">{formError}</p>}
        </div>

        <div className="sticky bottom-0 flex shrink-0 items-center justify-between border-t border-border bg-bg-surface-alt p-4">
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
