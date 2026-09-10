"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { calculateTrade } from "@/lib/calculateTrade";
import { formatINR } from "@/lib/format";
import { AlertCircleIcon, CheckCircleIcon, RefreshIcon } from "@/components/icons";
import { logEvent } from "@/lib/activityLog";
import LegsTable, { newLeg, toNumber, type LegRow } from "@/components/LegsTable";
import TradeInputsPanel from "@/components/TradeInputsPanel";
import { saveTrade } from "@/lib/tradeStore";
import { DEFAULT_LOT_SIZES, INSTRUMENT_LABELS, type Instrument, type SaveTradeLegInput } from "@/lib/types";

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
        <TradeInputsPanel
          instrument={instrument}
          lotSize={lotSize}
          lots={lots}
          qty={qty}
          onInstrumentChange={handleInstrumentChange}
          onLotSizeChange={handleLotSizeChange}
          onLotsChange={handleLotsChange}
          onQtyChange={handleQtyChange}
        />

        <LegsTable legs={legs} onLegChange={updateLeg} onAddLeg={addLeg} onRemoveLeg={removeLeg} />
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
