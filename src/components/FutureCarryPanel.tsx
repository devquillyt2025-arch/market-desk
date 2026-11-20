"use client";

import { useMemo } from "react";

import { ChevronDownIcon, TrendingDownIcon, TrendingUpIcon } from "@/components/icons";
import { isMarketOpen } from "@/lib/averaging";
import type { PortfolioRow } from "@/lib/calculatePortfolio";
import { formatAsOf, formatINR, formatLevel } from "@/lib/format";
import {
  buildFutureCarries,
  carryPnl,
  expectedFuture,
  isFutureCarry,
  shrinkOver,
  weekendCarry,
  type FutureCarry,
  type FutureCarryUnavailable,
} from "@/lib/futureCarry";
import { INSTRUMENT_LABELS } from "@/lib/types";

const UNAVAILABLE_TEXT: Record<FutureCarryUnavailable["reason"], string> = {
  no_price: "Waiting for the future's price.",
  no_index: "Waiting for the index level - the option chain of this expiry hasn't loaded yet.",
};

/** "+169.2" / "-4.1" - points, to a tenth once they are a point or more, to the hundredth below that. */
function points(value: number): string {
  const text = Math.abs(value) >= 1 ? Math.abs(value).toFixed(1) : Math.abs(value).toFixed(2);
  return value > 0 ? `+${text}` : value < 0 ? `-${text}` : text;
}

function signedINR(amount: number): string {
  const text = formatINR(Math.abs(amount));
  return amount > 0 ? `+${text}` : amount < 0 ? `-${text}` : text;
}

function expiryDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function contractName(item: { instrument: FutureCarry["instrument"]; expiry: string }): string {
  const month = new Date(`${item.expiry}T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
  return `${INSTRUMENT_LABELS[item.instrument]} ${month} future`;
}

function positionText(carry: FutureCarry): string {
  if (carry.netLots === 0) return "Long and short cancel out";
  const lots = Math.abs(carry.netLots);
  return `${carry.netLots < 0 ? "Short" : "Long"} ${lots} lot${lots === 1 ? "" : "s"} (${Math.abs(carry.netQty)})`;
}

/** What the position makes or loses to the carry, as the one coloured chip on the row. */
function PnlChip({ amount }: { amount: number }) {
  const direction = amount > 0 ? "up" : amount < 0 ? "down" : "flat";
  const color = direction === "up" ? "text-profit" : direction === "down" ? "text-danger-fg" : "text-muted-foreground";
  const bg = direction === "up" ? "bg-profit/10" : direction === "down" ? "bg-loss/15" : "bg-muted";
  const Arrow = direction === "down" ? TrendingDownIcon : TrendingUpIcon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 font-mono text-sm font-semibold tabular-nums ${bg} ${color}`}>
      {direction === "flat" ? <span aria-hidden="true">–</span> : <Arrow className="size-3.5" />}
      {signedINR(amount)}
      <span className="sr-only">
        {direction === "up" ? " gained from the carry" : direction === "down" ? " lost to the carry" : " no effect from the carry"}, if the index doesn&apos;t move
      </span>
    </span>
  );
}

/**
 * One line on a wide panel - the contract and what is held, `premium → expected shrink`, what that is worth to the position - in the
 * same three columns for every row, so the numbers line up down the list. On a phone the chip moves up beside the name and the
 * numbers take the line below.
 */
function Row({ carry, open }: { carry: FutureCarry; open: boolean }) {
  const shrink = shrinkOver(carry, 1);
  const pnl = carryPnl(carry, 1);
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto_6.5rem]">
      <div className="min-w-0">
        <p className="font-medium">{contractName(carry)}</p>
        <p className="text-xs text-muted-foreground">
          {positionText(carry)} · {Math.max(0, Math.round(carry.daysLeft))} days to expiry
        </p>
      </div>
      <p className="col-span-2 row-start-2 whitespace-nowrap font-mono tabular-nums sm:col-span-1 sm:col-start-2 sm:row-start-1">
        <span className="text-sm text-muted-foreground">
          <span className="font-sans">{carry.basis >= 0 ? "Premium" : "Discount"}</span> {points(carry.basis)}
        </span>
        <span aria-hidden="true" className="mx-2 text-muted-foreground">
          →
        </span>
        <span className="sr-only"> expected to {shrink >= 0 ? "shrink" : "narrow"} by {Math.abs(shrink).toFixed(1)} points {open ? "today" : "in a day"}: </span>
        <span className="text-xl font-semibold">{points(-shrink)}</span>
        <span className="ml-1 font-sans text-sm text-muted-foreground">pts {open ? "today" : "a day"}</span>
      </p>
      <div className="col-start-2 row-start-1 justify-self-end sm:col-start-3">{carry.netLots !== 0 && <PnlChip amount={pnl} />}</div>
    </li>
  );
}

/**
 * "Future vs spot": for each index future held, how far it trades above the index and how much of that is expected to go in a day -
 * and what that is worth to the position if the index itself doesn't move (a short collects it, a long pays it). The answer is a line
 * per future; how it is worked out is one click away rather than on screen all the time. Nothing at all unless a future is held.
 */
export function FutureCarryPanel({ rows, nowMs, className = "" }: { rows: readonly PortfolioRow[] | null; nowMs: number | null; className?: string }) {
  const items = useMemo(() => (rows && nowMs !== null ? buildFutureCarries(rows, nowMs) : []), [rows, nowMs]);
  if (items.length === 0 || nowMs === null) return null;

  const ready = items.filter(isFutureCarry);
  const waiting = items.filter((item): item is FutureCarryUnavailable => !isFutureCarry(item));
  const stale = ready.find((carry) => carry.stale);
  const open = isMarketOpen(nowMs);
  const weekend = weekendCarry(nowMs);

  return (
    <section aria-label="Future vs spot" className={`rounded-2xl border border-border bg-card p-4 sm:p-5 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Future vs spot</h3>
        <span className="text-xs text-muted-foreground">If the index doesn&apos;t move</span>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">How far the future is above the index → how much of that is expected to go {open ? "today" : "in a day"}</p>

      <ul className="mt-3 divide-y divide-border">
        {ready.map((carry) => (
          <Row key={carry.key} carry={carry} open={open} />
        ))}
        {waiting.map((item) => (
          <li key={item.key} className="py-3 first:pt-0 last:pb-0">
            <p className="font-medium">{contractName(item)}</p>
            <p className="text-xs text-muted-foreground">{UNAVAILABLE_TEXT[item.reason]}</p>
          </li>
        ))}
      </ul>

      {stale && (
        <p className="mt-3 text-xs text-warning-strong">
          These are the last prices seen{stale.asOf !== null ? ` (as of ${formatAsOf(stale.asOf)})` : ""}. They update when live pricing resumes.
        </p>
      )}

      {ready.length > 0 && (
        <details className="group mt-3 text-xs text-muted-foreground">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded font-medium transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
            <ChevronDownIcon className="size-3.5 transition-transform group-open:rotate-180" />
            How this is worked out
          </summary>
          <div className="mt-2 space-y-2 leading-relaxed">
            <p>
              The premium is the future&apos;s price less the index. It is worth nothing on the day the future expires, and it is roughly
              proportional to the time left, so it is spread evenly over the days to go: premium ÷ days left is what goes each day. The index is
              assumed to stay where it is, so a short future collects that and a long one pays it.
            </p>
            <ul className="space-y-1.5">
              {ready.map((carry) => {
                const day = shrinkOver(carry, 1);
                return (
                  <li key={carry.key}>
                    <span className="font-medium text-foreground">{contractName(carry)}:</span> future {formatLevel(carry.future)}, index{" "}
                    {formatLevel(carry.spot)}, {carry.basis >= 0 ? "premium" : "discount"} {formatLevel(Math.abs(carry.basis))} ({Math.abs(carry.basisPct).toFixed(2)}%
                    of the index) with {carry.daysLeft.toFixed(1)} days to {expiryDate(carry.expiry)}
                    {carry.annualisedPct !== null && `, ${carry.annualisedPct.toFixed(1)}% a year`}. If the index stays put the future should be near{" "}
                    {formatLevel(expectedFuture(carry, 1))} a day on, and by expiry the whole {formatLevel(Math.abs(carry.basis))} points go
                    {carry.netQty !== 0 && (
                      <>
                        {" "}
                        - {formatINR(Math.abs(carryPnl(carry, carry.daysLeft)))} on {Math.abs(carry.netQty)} units,{" "}
                        {carryPnl(carry, carry.daysLeft) >= 0 ? "to you" : "against you"}
                      </>
                    )}
                    .
                    {weekend && ` Over the weekend, ${weekend.days} days of it is about ${Math.abs(day * weekend.days).toFixed(1)} points.`}
                  </li>
                );
              })}
            </ul>
            {weekend && (
              <p>
                {weekend.when === "since"
                  ? "Carry builds by calendar day, weekends included. Monday's price already has the weekend in it, so from here it is a day at a time."
                  : "Carry builds by calendar day, weekends included: by Monday's close it will have been three days' worth."}
              </p>
            )}
            <p>
              A drift, not a forecast. The real premium also moves with interest rates, dividends and sentiment, so it wobbles around this line,
              and where the index goes moves a future by far more than the carry does.
            </p>
          </div>
        </details>
      )}
    </section>
  );
}
