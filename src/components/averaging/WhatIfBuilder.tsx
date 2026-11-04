"use client";

/**
 * "Your what-if" — everything the person decides: how many lots, at what price,
 * and against how much money.
 *
 * It's laid out by the room it has (a container query, not the window). Wide:
 * the three decisions side by side in the top row — lots, price, funds — with
 * the slider and its quick picks running the whole width underneath (a long
 * slider is also a precise one), and, once funds are entered, the budget bar
 * across the bottom. Narrow: the same pieces stacked in reading order.
 */

import type { ReactNode } from "react";

import { LockIcon } from "@/components/icons";
import Stepper from "@/components/Stepper";
import { DeltaChip, num, pillButton, Section, signedPct } from "@/components/averaging/ui";
import { lotsWithinRiskLimit, maxAffordableLots, PRICE_TICK } from "@/lib/averaging";
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
  /** A compact read-out of the result, shown under the slider until the full result card sits below. */
  liveSummary?: ReactNode;
  className?: string;
};

/** How the buy price compares with what you already paid — the thing that decides whether this is averaging down. */
function PriceContext({ buyPrice, avgPrice, lotSize }: { buyPrice: number; avgPrice: number; lotSize: number }) {
  if (!(buyPrice > 0) || !(avgPrice > 0)) return null;
  const diff = ((buyPrice - avgPrice) / avgPrice) * 100;
  const same = Math.abs(diff) < 0.05;
  return (
    <div className="flex flex-col items-start gap-1.5">
      {same ? (
        <DeltaChip direction="flat" quality="neutral">
          same as your average
        </DeltaChip>
      ) : diff < 0 ? (
        <DeltaChip direction="down" quality="good">
          {Math.abs(diff).toFixed(1)}% below your average
        </DeltaChip>
      ) : (
        <DeltaChip direction="up" quality="bad">
          {diff.toFixed(1)}% above your average
        </DeltaChip>
      )}
      <p className="font-mono text-xs tabular-nums text-muted-foreground">
        1 lot = {lotSize} × {num(buyPrice)} = {formatINR(lotSize * buyPrice)}
      </p>
    </div>
  );
}

function BudgetBar({
  funds,
  riskLimitPct,
  capitalBefore,
  capitalAfter,
  maxLots,
  limitLots,
}: {
  funds: number;
  riskLimitPct: number;
  capitalBefore: number;
  capitalAfter: number;
  /** Lots the funds cover at this price. */
  maxLots: number;
  /** Lots that stay within the risk limit at this price. */
  limitLots: number;
}) {
  const share = (capitalAfter / funds) * 100;
  const existing = Math.min((capitalBefore / funds) * 100, 100);
  const added = Math.min(((capitalAfter - capitalBefore) / funds) * 100, 100 - existing);
  const over = share > 100;
  const overLimit = share > riskLimitPct;
  const addedColor = over ? "bg-danger-fg" : overLimit ? "bg-warning" : "bg-accent-solid";
  const status = over ? "Over your funds" : overLimit ? `Over your ${riskLimitPct}% limit` : "Within your limit";
  const plural = (n: number) => `${n} lot${n === 1 ? "" : "s"}`;

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
        <div className="absolute inset-y-0 left-0 bg-muted-foreground/50 transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${existing}%` }} />
        <div
          className={`absolute inset-y-0 transition-[left,width] duration-300 motion-reduce:transition-none ${addedColor}`}
          style={{ left: `${existing}%`, width: `${Math.max(added, 0)}%` }}
        />
        <div
          className="absolute inset-y-0 w-0.5 bg-foreground"
          style={{ left: `${Math.min(riskLimitPct, 100)}%` }}
          title={`Your ${riskLimitPct}% limit`}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
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
      </div>
      {/* Three cells of fixed share, so the wording changing can't re-wrap a row and move the card. */}
      <div className="grid gap-x-6 gap-y-1 text-xs @min-[52rem]:grid-cols-3">
        <p className={`font-medium ${over ? "text-danger-fg" : overLimit ? "text-warning" : "text-muted-foreground"}`}>{status}</p>
        <p className="text-muted-foreground">
          Your funds cover up to <span className="font-mono font-semibold tabular-nums text-foreground">{plural(maxLots)}</span> here
        </p>
        <p className="text-muted-foreground">
          {limitLots > 0 ? (
            <>
              <span className="font-mono font-semibold tabular-nums text-foreground">{plural(limitLots)}</span> keep you within {riskLimitPct}%
            </>
          ) : (
            <>No room left under your {riskLimitPct}% limit</>
          )}
        </p>
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
    liveSummary,
    className = "",
  } = props;

  const maxLots = maxAffordableLots(funds, lotSize, buyPrice);
  const limitLots = lotsWithinRiskLimit(funds, riskLimitPct, capitalBefore, lotSize, buyPrice);

  // From 44rem the blocks are placed on a grid by hand (the DOM stays in reading order for a narrow card):
  // lots | price | funds across the top, the slider across the middle, the budget bar across the bottom.
  // (Every class is written out in full — Tailwind only generates what it can read in the source.)

  return (
    <Section step={1} title="Your what-if" subtitle="Move the slider — everything on this page updates." className={className}>
      <div className="@container">
        <div className="grid gap-5 rounded-2xl border border-border bg-background p-4 shadow-sm sm:p-5 @min-[52rem]:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1.3fr)] @min-[52rem]:gap-x-6 @min-[52rem]:gap-y-5">
          {/* Lots */}
          <div className={`flex flex-col gap-1.5 @min-[52rem]:col-start-1 @min-[52rem]:row-start-1`}>
            {/*
              Nothing here may change size as the numbers do — it's what you're dragging while you watch it. So the
              stepper never shrinks (shrink-0, and a width that beats the field's own w-full), and the changing
              "qty · cost" text has its own line instead of sharing a row it could wrap in.
            */}
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <label htmlFor="averaging-lots" className="text-xs font-medium text-muted-foreground">
                  Lots to add
                </label>
                <p className="flex items-baseline gap-2 whitespace-nowrap">
                  <span className="font-mono text-4xl font-semibold leading-none tabular-nums">{lots}</span>
                  <span className="text-sm text-muted-foreground">{lots === 1 ? "lot" : "lots"}</span>
                </p>
              </div>
              <div className="shrink-0">
                <Stepper value={lots} onChange={(v) => onLots(Math.round(v))} step={1} min={0} max={1000} width="w-16!" label="lots to add" large />
              </div>
            </div>
            <p className="whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground">
              {extraQty} qty · {formatINR(extraCost)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Lot size {lotSize} · you hold {heldLots} lot{heldLots === 1 ? "" : "s"} at {num(avgPrice)}
            </p>
          </div>

          {/* The slider and quick picks: under the lots on a narrow card, the full width of the card on a wide one. */}
          <div className={`flex flex-col gap-3 @min-[52rem]:col-span-3 @min-[52rem]:col-start-1 @min-[52rem]:row-start-2 @min-[52rem]:border-t @min-[52rem]:border-border @min-[52rem]:pt-5`}>
            <div className={`flex flex-col gap-3 @min-[52rem]:flex-row @min-[52rem]:items-center @min-[52rem]:gap-8`}>
              <div className="min-w-0 flex-1">
                <input
                  id="averaging-lots"
                  type="range"
                  min={0}
                  max={sliderMax}
                  step={1}
                  value={Math.min(lots, sliderMax)}
                  onChange={(e) => onLots(Number(e.target.value))}
                  aria-label="Lots to add"
                  className="block h-8 w-full cursor-pointer accent-accent"
                />
                <div aria-hidden="true" className="flex justify-between text-[11px] tabular-nums text-muted-foreground">
                  <span>0</span>
                  <span>{sliderMax} lots</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {quickPicks.map((q) => (
                  <button key={q.key} type="button" aria-pressed={lots === q.lots} onClick={() => onLots(q.lots)} className={pillButton(lots === q.lots)}>
                    {q.label}
                  </button>
                ))}
              </div>
            </div>
            {liveSummary && <div className={`@min-[52rem]:hidden`}>{liveSummary}</div>}
          </div>

          {/* Price */}
          <div
            className={`flex flex-col gap-2.5 border-t border-border pt-4 @min-[52rem]:col-start-2 @min-[52rem]:row-start-1 @min-[52rem]:border-l @min-[52rem]:border-t-0 @min-[52rem]:pl-6 @min-[52rem]:pt-0`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="averaging-price" className="text-xs font-medium text-muted-foreground">
                Buy price
                {!locked && (
                  <span className="ml-1.5 inline-flex items-center gap-1 text-[10px] font-semibold text-profit">
                    <span className="size-1.5 animate-pulse rounded-full bg-profit motion-reduce:animate-none" aria-hidden="true" />
                    follows live
                  </span>
                )}
              </label>
              <button
                type="button"
                onClick={onToggleLock}
                aria-pressed={locked}
                title={locked ? "Follow the live price again" : "Freeze the buy price"}
                className={`${pillButton(locked)} min-w-24`}
              >
                <LockIcon className="size-3.5" />
                {locked ? "Locked" : "Lock"}
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
            <PriceContext buyPrice={buyPrice} avgPrice={avgPrice} lotSize={lotSize} />
          </div>

          {/* Funds and the risk limit */}
          <div
            className={`flex flex-col gap-3 border-t border-border pt-4 @min-[52rem]:col-start-3 @min-[52rem]:row-start-1 @min-[52rem]:border-l @min-[52rem]:border-t-0 @min-[52rem]:pl-6 @min-[52rem]:pt-0`}
          >
            <div className="grid grid-cols-1 gap-3 @min-[30rem]:grid-cols-2 @min-[52rem]:grid-cols-1 @min-[68rem]:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="averaging-funds" className="text-xs font-medium text-muted-foreground">
                  Available funds (₹)
                </label>
                {/* NaN renders as an empty field, so "not set" doesn't masquerade as ₹0. */}
                <Stepper
                  id="averaging-funds"
                  value={funds ?? Number.NaN}
                  placeholder="Not set"
                  onChange={(v) => onFunds(v > 0 ? v : null)}
                  step={5000}
                  min={0}
                  width="w-24"
                  label="available funds"
                  large
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="averaging-limit" className="text-xs font-medium text-muted-foreground">
                  Risk limit (% of funds)
                </label>
                <Stepper id="averaging-limit" value={riskLimitPct} onChange={onRiskLimit} step={5} min={1} max={100} width="w-14" label="capital-at-risk limit percent" large />
              </div>
            </div>
            {funds === null && (
              <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
                Add your available funds to see how much of your budget this uses, and how many lots you can afford.
              </p>
            )}
          </div>

          {/* The budget bar — only once there are funds to measure against; across the bottom of a wide card. */}
          {funds !== null && (
            <div className={`border-t border-border pt-4 @min-[52rem]:col-span-3 @min-[52rem]:col-start-1 @min-[52rem]:row-start-3 @min-[52rem]:pt-5`}>
              <BudgetBar
                funds={funds}
                riskLimitPct={riskLimitPct}
                capitalBefore={capitalBefore}
                capitalAfter={capitalAfter}
                maxLots={maxLots}
                limitLots={limitLots}
              />
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}
