"use client";

/**
 * "Your what-if" — everything the person decides: how many lots, at what price,
 * and against how much money. The budget bar shows at a glance what share of
 * funds is already in the trade, what the new lots add, and where the limit is.
 */

import { LockIcon } from "@/components/icons";
import Stepper from "@/components/Stepper";
import { num, pillButton, Section, signedPct } from "@/components/averaging/ui";
import { PRICE_TICK } from "@/lib/averaging";
import { formatINR } from "@/lib/format";

export type QuickPick = { key: string; label: string; lots: number };

type WhatIfBuilderProps = {
  lots: number;
  onLots: (lots: number) => void;
  sliderMax: number;
  quickPicks: QuickPick[];
  lotSize: number;
  heldLots: number;
  avgPrice: number;
  extraQty: number;
  extraCost: number;

  buyPrice: number;
  locked: boolean;
  ltp: number;
  /** The frozen price, when the live one has drifted from it. */
  movedFrom: number | null;
  onPrice: (price: number) => void;
  onToggleLock: () => void;
  onUseLive: () => void;

  funds: number | null;
  riskLimitPct: number;
  onFunds: (funds: number | null) => void;
  onRiskLimit: (pct: number) => void;
  capitalBefore: number;
  capitalAfter: number;
  className?: string;
};

function BudgetBar({
  funds,
  riskLimitPct,
  capitalBefore,
  capitalAfter,
}: {
  funds: number;
  riskLimitPct: number;
  capitalBefore: number;
  capitalAfter: number;
}) {
  const share = (capitalAfter / funds) * 100;
  const existing = Math.min((capitalBefore / funds) * 100, 100);
  const added = Math.min(((capitalAfter - capitalBefore) / funds) * 100, 100 - existing);
  const over = share > 100;
  const overLimit = share > riskLimitPct;
  const addedColor = over ? "bg-danger-fg" : overLimit ? "bg-warning" : "bg-accent-solid";
  const status = over ? "Over your funds" : overLimit ? `Over your ${riskLimitPct}% limit` : "Within your limit";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">Share of funds in this trade</p>
        <p className={`font-mono text-sm font-semibold tabular-nums ${over ? "text-danger-fg" : overLimit ? "text-warning" : "text-foreground"}`}>
          {share.toFixed(1)}%
        </p>
      </div>
      <div
        role="meter"
        aria-label="Share of funds in this trade"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(Math.round(share), 100)}
        aria-valuetext={`${share.toFixed(1)} percent of funds. ${status}.`}
        className="relative h-3 overflow-hidden rounded-full bg-muted"
      >
        <div className="absolute inset-y-0 left-0 bg-muted-foreground/50" style={{ width: `${existing}%` }} />
        <div className={`absolute inset-y-0 ${addedColor}`} style={{ left: `${existing}%`, width: `${Math.max(added, 0)}%` }} />
        <div
          className="absolute inset-y-0 w-0.5 bg-foreground"
          style={{ left: `${Math.min(riskLimitPct, 100)}%` }}
          title={`Your ${riskLimitPct}% limit`}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm bg-muted-foreground/50" aria-hidden="true" />
            Already in
          </span>
          <span className="flex items-center gap-1.5">
            <span className={`size-2 rounded-sm ${addedColor}`} aria-hidden="true" />
            New lots
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-0.5 bg-foreground" aria-hidden="true" />
            Limit {riskLimitPct}%
          </span>
        </span>
        <span className={over ? "font-medium text-danger-fg" : overLimit ? "font-medium text-warning" : ""}>{status}</span>
      </div>
    </div>
  );
}

export default function WhatIfBuilder(props: WhatIfBuilderProps) {
  const {
    lots,
    onLots,
    sliderMax,
    quickPicks,
    lotSize,
    heldLots,
    avgPrice,
    extraQty,
    extraCost,
    buyPrice,
    locked,
    ltp,
    movedFrom,
    onPrice,
    onToggleLock,
    onUseLive,
    funds,
    riskLimitPct,
    onFunds,
    onRiskLimit,
    capitalBefore,
    capitalAfter,
    className = "",
  } = props;

  return (
    <Section title="Your what-if" subtitle="Move the slider — everything on this page updates." className={className}>
      <div className="flex flex-col gap-5 rounded-2xl border border-border bg-background p-4 sm:p-5">
        {/* Lots */}
        <div className="flex flex-col gap-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <label htmlFor="averaging-lots" className="text-xs font-medium text-muted-foreground">
                Lots to add
              </label>
              <p className="font-mono text-4xl font-semibold leading-none tabular-nums">{lots}</p>
              <p className="mt-1.5 font-mono text-xs tabular-nums text-muted-foreground">
                {extraQty} qty · {formatINR(extraCost)}
              </p>
            </div>
            <Stepper value={lots} onChange={(v) => onLots(Math.round(v))} step={1} min={0} max={1000} width="w-16" label="lots to add" large />
          </div>
          <input
            id="averaging-lots"
            type="range"
            min={0}
            max={sliderMax}
            step={1}
            value={Math.min(lots, sliderMax)}
            onChange={(e) => onLots(Number(e.target.value))}
            className="h-8 w-full cursor-pointer accent-accent"
          />
          <div className="flex flex-wrap items-center gap-2">
            {quickPicks.map((q) => (
              <button key={q.key} type="button" aria-pressed={lots === q.lots} onClick={() => onLots(q.lots)} className={pillButton(lots === q.lots)}>
                {q.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Lot size {lotSize} · you hold {heldLots} lot{heldLots === 1 ? "" : "s"} at {num(avgPrice)}
          </p>
        </div>

        {/* Price */}
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="averaging-price" className="text-xs font-medium text-muted-foreground">
              Buy price
              {!locked && (
                <span className="ml-1.5 inline-flex items-center gap-1 text-[10px] font-semibold text-profit">
                  <span className="size-1.5 animate-pulse rounded-full bg-profit motion-reduce:animate-none" aria-hidden="true" />
                  follows live
                </span>
              )}
            </label>
            <button type="button" onClick={onToggleLock} aria-pressed={locked} title={locked ? "Follow the live price again" : "Freeze the buy price"} className={pillButton(locked)}>
              <LockIcon className="size-3.5" />
              {locked ? "Locked" : "Lock price"}
            </button>
          </div>
          <Stepper id="averaging-price" value={buyPrice} onChange={onPrice} step={PRICE_TICK} precision={2} min={0} width="w-28" label="buy price" large />
          {movedFrom !== null && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-warning/15 px-2 py-0.5 font-semibold text-warning">
                LTP moved {signedPct(((ltp - movedFrom) / movedFrom) * 100)}
              </span>
              <span className="font-mono tabular-nums text-muted-foreground">
                now {num(ltp)} · locked {num(movedFrom)}
              </span>
              <button type="button" onClick={onUseLive} className="min-h-9 font-medium text-accent hover:underline">
                Use live
              </button>
            </div>
          )}
        </div>

        {/* Budget */}
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="averaging-funds" className="text-xs font-medium text-muted-foreground">
                Available funds (₹)
              </label>
              <Stepper id="averaging-funds" value={funds ?? 0} onChange={(v) => onFunds(v > 0 ? v : null)} step={5000} min={0} width="w-24" label="available funds" large />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="averaging-limit" className="text-xs font-medium text-muted-foreground">
                Risk limit (% of funds)
              </label>
              <Stepper id="averaging-limit" value={riskLimitPct} onChange={onRiskLimit} step={5} min={1} max={100} width="w-14" label="capital-at-risk limit percent" large />
            </div>
          </div>
          {funds === null ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
              Add your available funds to see how much of your budget this uses, and how many lots you can afford.
            </p>
          ) : (
            <BudgetBar funds={funds} riskLimitPct={riskLimitPct} capitalBefore={capitalBefore} capitalAfter={capitalAfter} />
          )}
        </div>
      </div>
    </Section>
  );
}
