"use client";

import { useId } from "react";

import { INSTRUMENTS, INSTRUMENT_LABELS, type Instrument } from "@/lib/types";

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-accent focus:ring-2 focus:ring-accent/30";

const labelClass = "text-xs font-medium uppercase tracking-wide text-muted-foreground";

function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

type TradeInputsPanelProps = {
  instrument: Instrument;
  lotSize: number;
  lots: number;
  qty: number;
  onInstrumentChange: (next: Instrument) => void;
  onLotSizeChange: (next: number) => void;
  onLotsChange: (next: number) => void;
  onQtyChange: (next: number) => void;
};

export default function TradeInputsPanel({
  instrument,
  lotSize,
  lots,
  qty,
  onInstrumentChange,
  onLotSizeChange,
  onLotsChange,
  onQtyChange,
}: TradeInputsPanelProps) {
  const formId = useId();

  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className={labelClass}>Instrument</span>
          <div className="inline-flex w-fit rounded-lg border border-border bg-muted p-1">
            {INSTRUMENTS.map((inst) => (
              <button
                key={inst}
                type="button"
                onClick={() => onInstrumentChange(inst)}
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
              onChange={(e) => onLotSizeChange(Math.max(1, Math.trunc(toNumber(e.target.value))))}
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
              onChange={(e) => onLotsChange(Math.max(1, Math.trunc(toNumber(e.target.value))))}
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
              onChange={(e) => onQtyChange(Math.max(1, Math.trunc(toNumber(e.target.value))))}
              className={`${inputClass} font-mono font-medium tabular-nums`}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
