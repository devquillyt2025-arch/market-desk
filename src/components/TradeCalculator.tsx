"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { calculateTrade } from "@/lib/calculateTrade";
import { formatINR } from "@/lib/format";
import { AlertCircleIcon, CheckCircleIcon, PlusIcon, RefreshIcon, TrashIcon } from "@/components/icons";
import { logEvent } from "@/lib/activityLog";
import { saveTrade } from "@/lib/tradeStore";
import {
  DEFAULT_LOT_SIZES,
  INSTRUMENTS,
  INSTRUMENT_LABELS,
  type Instrument,
  type SaveTradeLegInput,
} from "@/lib/types";

type LegRow = {
  key: number;
  sellPrice: string;
  buyPrice: string;
};

let nextLegKey = 0;
function newLeg(): LegRow {
  return { key: nextLegKey++, sellPrice: "", buyPrice: "" };
}

function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-accent focus:ring-2 focus:ring-accent/30";

const labelClass = "text-xs font-medium uppercase tracking-wide text-muted-foreground";

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved" }
  | { status: "error"; message: string };

/** Coalesces rapid keystrokes into one log entry instead of one per character. */
const LOG_DEBOUNCE_MS = 600;

export default function TradeCalculator() {
  const [instrument, setInstrument] = useState<Instrument>("NIFTY");
  const [lotSize, setLotSize] = useState(DEFAULT_LOT_SIZES.NIFTY);
  const [lots, setLots] = useState(1);
  const [qty, setQty] = useState(DEFAULT_LOT_SIZES.NIFTY);
  const [legs, setLegs] = useState<LegRow[]>([newLeg(), newLeg()]);
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });

  const formId = useId();
  const pendingLogs = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const timers = pendingLogs.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  function logDebounced(key: string, message: string) {
    const timers = pendingLogs.current;
    const existing = timers.get(key);
    if (existing) clearTimeout(existing);
    timers.set(
      key,
      setTimeout(() => {
        logEvent(message);
        timers.delete(key);
      }, LOG_DEBOUNCE_MS),
    );
  }

  function cancelPendingLogs() {
    const timers = pendingLogs.current;
    timers.forEach((timer) => clearTimeout(timer));
    timers.clear();
  }

  // Qty tracks lots × lot size by default, but stays a plain editable field
  // (set directly here rather than in an effect) so an odd-lot override
  // doesn't fight the two inputs that drive it.
  function handleInstrumentChange(next: Instrument) {
    if (next === instrument) return;
    const nextLotSize = DEFAULT_LOT_SIZES[next];
    setInstrument(next);
    setLotSize(nextLotSize);
    setQty(lots * nextLotSize);
    logEvent(`Instrument changed to ${INSTRUMENT_LABELS[next]}`);
  }

  function handleLotSizeChange(nextLotSize: number) {
    setLotSize(nextLotSize);
    setQty(lots * nextLotSize);
    if (nextLotSize !== lotSize) logDebounced("lotSize", `Lot size changed to ${nextLotSize}`);
  }

  function handleLotsChange(nextLots: number) {
    setLots(nextLots);
    setQty(nextLots * lotSize);
    if (nextLots !== lots) logDebounced("lots", `Lots changed to ${nextLots}`);
  }

  function handleQtyChange(nextQty: number) {
    setQty(nextQty);
    if (nextQty !== qty) logDebounced("qty", `Qty changed to ${nextQty}`);
  }

  function updateLeg(key: number, field: "sellPrice" | "buyPrice", value: string) {
    setLegs((prev) => prev.map((leg) => (leg.key === key ? { ...leg, [field]: value } : leg)));
    const legNumber = legs.findIndex((leg) => leg.key === key) + 1;
    const fieldLabel = field === "sellPrice" ? "Sell price" : "Buy price";
    logDebounced(
      `leg-${key}-${field}`,
      `${fieldLabel} for leg ${legNumber} changed to ${value || "0"}`,
    );
  }

  function addLeg() {
    setLegs((prev) => [...prev, newLeg()]);
    logEvent(`Added leg ${legs.length + 1}`);
  }

  function removeLeg(key: number) {
    const legNumber = legs.findIndex((leg) => leg.key === key) + 1;
    setLegs((prev) => (prev.length > 1 ? prev.filter((leg) => leg.key !== key) : prev));
    if (legs.length > 1) logEvent(`Removed leg ${legNumber}`);
  }

  function resetForm() {
    cancelPendingLogs();
    setInstrument("NIFTY");
    setLotSize(DEFAULT_LOT_SIZES.NIFTY);
    setLots(1);
    setQty(DEFAULT_LOT_SIZES.NIFTY);
    setLegs([newLeg(), newLeg()]);
    setSaveState({ status: "idle" });
    logEvent("Reset calculator form");
  }

  const calculation = calculateTrade(
    legs.map((leg) => ({
      sellPrice: toNumber(leg.sellPrice),
      buyPrice: toNumber(leg.buyPrice),
    })),
    qty,
  );

  const sign = calculation.totalPnl > 0 ? "profit" : calculation.totalPnl < 0 ? "loss" : "flat";
  const pnlColor = sign === "profit" ? "text-profit" : sign === "loss" ? "text-loss" : "text-foreground";

  async function handleSave() {
    setSaveState({ status: "saving" });
    try {
      const legsPayload: SaveTradeLegInput[] = calculation.legs.map((leg, index) => ({
        sell_price: leg.sellPrice,
        buy_price: leg.buyPrice,
        net: leg.net,
        leg_order: index,
      }));

      await saveTrade({
        instrument,
        lots,
        lotSize,
        qty,
        totalNet: calculation.totalNet,
        totalPnl: calculation.totalPnl,
        legs: legsPayload,
      });

      setSaveState({ status: "saved" });
    } catch (err) {
      setSaveState({
        status: "error",
        message: err instanceof Error ? err.message : "Failed to save trade.",
      });
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3 lg:items-start">
      <div className="flex flex-col gap-6 lg:col-span-2">
        <section className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className={labelClass}>Instrument</span>
              <div className="inline-flex w-fit rounded-lg border border-border bg-muted p-1">
                {INSTRUMENTS.map((inst) => (
                  <button
                    key={inst}
                    type="button"
                    onClick={() => handleInstrumentChange(inst)}
                    className={
                      inst === instrument
                        ? "rounded-md bg-card px-3.5 py-1.5 text-sm font-medium text-foreground shadow-sm"
                        : "rounded-md px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                    }
                  >
                    {INSTRUMENT_LABELS[inst]}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 sm:max-w-sm">
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${formId}-lot-size`} className={labelClass}>
                  Lot size
                </label>
                <input
                  id={`${formId}-lot-size`}
                  type="number"
                  min={1}
                  step={1}
                  value={lotSize}
                  onChange={(e) =>
                    handleLotSizeChange(Math.max(1, Math.trunc(toNumber(e.target.value))))
                  }
                  className={`${inputClass} font-mono tabular-nums`}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${formId}-lots`} className={labelClass}>
                  Lots
                </label>
                <input
                  id={`${formId}-lots`}
                  type="number"
                  min={1}
                  step={1}
                  value={lots}
                  onChange={(e) =>
                    handleLotsChange(Math.max(1, Math.trunc(toNumber(e.target.value))))
                  }
                  className={`${inputClass} font-mono tabular-nums`}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${formId}-qty`} className={labelClass}>
                  Qty
                </label>
                <input
                  id={`${formId}-qty`}
                  type="number"
                  min={1}
                  step={1}
                  value={qty}
                  onChange={(e) => handleQtyChange(Math.max(1, Math.trunc(toNumber(e.target.value))))}
                  className={`${inputClass} font-mono font-medium tabular-nums`}
                />
              </div>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left text-muted-foreground">
                  <th className="w-10 py-3 pl-5 pr-2 font-medium">#</th>
                  <th className="px-2 py-3 font-medium">Sell Price</th>
                  <th className="px-2 py-3 font-medium">Buy Price</th>
                  <th className="px-2 py-3 text-right font-medium">Net</th>
                  <th className="w-12 py-3 pr-4" />
                </tr>
              </thead>
              <tbody>
                {legs.map((leg, index) => {
                  const net = toNumber(leg.sellPrice) - toNumber(leg.buyPrice);
                  const legSign = net > 0 ? "profit" : net < 0 ? "loss" : null;
                  return (
                    <tr
                      key={leg.key}
                      className="border-b border-border last:border-0 hover:bg-muted/30"
                    >
                      <td className="py-2.5 pl-5 pr-2 text-muted-foreground">{index + 1}</td>
                      <td className="px-2 py-2.5">
                        <input
                          type="number"
                          step="0.05"
                          inputMode="decimal"
                          value={leg.sellPrice}
                          onChange={(e) => updateLeg(leg.key, "sellPrice", e.target.value)}
                          placeholder="0.00"
                          className={`${inputClass} max-w-32 font-mono tabular-nums`}
                        />
                      </td>
                      <td className="px-2 py-2.5">
                        <input
                          type="number"
                          step="0.05"
                          inputMode="decimal"
                          value={leg.buyPrice}
                          onChange={(e) => updateLeg(leg.key, "buyPrice", e.target.value)}
                          placeholder="0.00"
                          className={`${inputClass} max-w-32 font-mono tabular-nums`}
                        />
                      </td>
                      <td className="px-2 py-2.5 text-right">
                        <span
                          className={`inline-block min-w-20 rounded-md px-2 py-1 font-mono text-sm font-medium tabular-nums ${
                            legSign === "profit"
                              ? "bg-profit/10 text-profit"
                              : legSign === "loss"
                                ? "bg-loss/10 text-loss"
                                : "text-muted-foreground"
                          }`}
                        >
                          {net.toFixed(2)}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 text-center">
                        <button
                          type="button"
                          onClick={() => removeLeg(leg.key)}
                          disabled={legs.length === 1}
                          className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-loss/10 hover:text-loss disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
                          aria-label={`Remove leg ${index + 1}`}
                        >
                          <TrashIcon className="size-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            onClick={addLeg}
            className="flex w-full items-center justify-center gap-1.5 border-t border-dashed border-border py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
          >
            <PlusIcon className="size-4" />
            Add Leg
          </button>
        </section>
      </div>

      <div className="flex flex-col gap-4 lg:sticky lg:top-8">
        <section className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
          <h2 className="text-sm font-medium text-muted-foreground">Summary</h2>

          <dl className="mt-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <dt className="text-sm text-muted-foreground">Total Net</dt>
              <dd className="font-mono text-sm font-medium tabular-nums">
                {calculation.totalNet.toFixed(2)}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-sm text-muted-foreground">Qty</dt>
              <dd className="font-mono text-sm font-medium tabular-nums">{qty}</dd>
            </div>
          </dl>

          <div className="mt-4 border-t border-border pt-4">
            <dt className="text-sm text-muted-foreground">Total P&amp;L</dt>
            <dd className={`mt-1 font-mono text-3xl font-semibold tabular-nums ${pnlColor}`}>
              {formatINR(calculation.totalPnl)}
            </dd>
          </div>
        </section>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saveState.status === "saving"}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saveState.status === "saving" ? "Saving..." : "Save Trade"}
          </button>
          <button
            type="button"
            onClick={resetForm}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <RefreshIcon className="size-4" />
            Reset
          </button>
        </div>

        {saveState.status === "saved" && (
          <p className="flex items-center gap-1.5 text-sm text-profit">
            <CheckCircleIcon className="size-4 shrink-0" />
            Saved to this browser — view it on the{" "}
            <Link href="/history" className="underline underline-offset-2">
              History
            </Link>{" "}
            page.
          </p>
        )}
        {saveState.status === "error" && (
          <p className="flex items-start gap-1.5 text-sm text-loss">
            <AlertCircleIcon className="size-4 shrink-0 translate-y-0.5" />
            {saveState.message}
          </p>
        )}
      </div>
    </div>
  );
}
