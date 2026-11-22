"use client";

/**
 * The nine timeframes at a glance: a switcher (each button with the colour of its latest completed Heikin Ashi bar and a mark when
 * the flip is fresh) above a table of what each says - the colour, bars since the last flip, the signal, the ATR, and the stop and
 * target at 1:2. Choosing one (button or row) points the signal, plan and chart at it. Nothing here ranks the timeframes.
 */

import { DEFAULT_ATR_MULT, TIMEFRAMES, type Timeframe } from "@/lib/natgasPlanner/config";
import { makePlan } from "@/lib/natgasPlanner/plan";
import type { TfOverview } from "@/lib/natgasPlanner/signals";

import { MoveArrow } from "./direction";
import { price, tfLabel } from "./plannerFormat";

function Dot({ green }: { green: boolean | null }) {
  if (green === null) return <span aria-hidden="true" className="size-2.5 rounded-full border border-dashed border-border-strong" />;
  return (
    <>
      <span aria-hidden="true" className={`size-2.5 rounded-full ${green ? "bg-profit" : "bg-danger-fg"}`} />
      <span className="sr-only">{green ? "green" : "red"}</span>
    </>
  );
}

export function TimeframeSwitcher({ timeframes, selected, onSelect }: { timeframes: readonly TfOverview[]; selected: Timeframe; onSelect: (tf: Timeframe) => void }) {
  return (
    <div role="group" aria-label="Timeframe" className="grid grid-cols-5 gap-1.5 sm:grid-cols-9">
      {TIMEFRAMES.map((tf) => {
        const o = timeframes.find((t) => t.tf === tf);
        const active = tf === selected;
        return (
          <button
            key={tf}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(tf)}
            className={`relative flex min-h-11 items-center justify-center gap-1.5 rounded-xl border px-2 text-sm font-semibold tabular-nums transition-colors sm:min-h-10 ${
              active ? "border-accent bg-accent/10 text-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {tfLabel(tf)}
            <Dot green={o?.green ?? null} />
            {o?.fresh && (
              <>
                <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-card bg-accent" />
                <span className="sr-only"> fresh {o.direction} signal</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function OverviewTable({ timeframes, selected, onSelect, entry }: { timeframes: readonly TfOverview[]; selected: Timeframe; onSelect: (tf: Timeframe) => void; entry: number | null }) {
  const head = "pb-2 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground";
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[20rem] text-sm">
        <caption className="sr-only">What each timeframe&apos;s latest completed Heikin Ashi bar says</caption>
        <thead>
          <tr>
            <th scope="col" className={`${head} pr-3`}>
              Timeframe
            </th>
            <th scope="col" className={`${head} pr-3`}>
              Bar
            </th>
            <th scope="col" className={`${head} hidden pr-3 sm:table-cell`}>
              Since flip
            </th>
            <th scope="col" className={`${head} pr-3`}>
              Signal
            </th>
            <th scope="col" className={`${head} hidden pr-3 md:table-cell`}>
              ATR
            </th>
            <th scope="col" className={head}>
              Stop · target at 1:2
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {timeframes.map((o) => {
            const plan = o.direction && entry ? makePlan({ side: o.direction, entry, atr: o.atr, atrMult: DEFAULT_ATR_MULT, ratio: 2, riskBudget: 0 }) : null;
            const active = o.tf === selected;
            return (
              <tr key={o.tf} onClick={() => onSelect(o.tf)} className={`cursor-pointer transition-colors hover:bg-muted/50 ${active ? "bg-accent/8" : ""}`} aria-selected={active}>
                <th scope="row" className="py-2 pr-3 text-left font-semibold tabular-nums">
                  <button type="button" onClick={() => onSelect(o.tf)} aria-label={`Show the ${tfLabel(o.tf)} timeframe`} aria-current={active} className="min-h-9 rounded pr-2 text-left focus-visible:outline-2 focus-visible:outline-accent pointer-coarse:min-h-11">
                    {tfLabel(o.tf)}
                  </button>
                </th>
                <td className="py-2 pr-3">
                  <span className="inline-flex items-center gap-1.5 text-xs">
                    <Dot green={o.green} />
                    <span aria-hidden="true">{o.green === null ? "–" : o.green ? "green" : "red"}</span>
                  </span>
                </td>
                <td className="hidden py-2 pr-3 tabular-nums text-muted-foreground sm:table-cell">{o.barsSinceFlip === null ? "–" : o.barsSinceFlip}</td>
                <td className="py-2 pr-3">
                  {o.direction ? (
                    <span className="inline-flex items-center gap-1.5 font-semibold">
                      <MoveArrow direction={o.direction === "long" ? "up" : "down"} />
                      {o.direction === "long" ? "Long" : "Short"}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">None</span>
                  )}
                </td>
                <td className="hidden py-2 pr-3 tabular-nums text-muted-foreground md:table-cell">{o.atr === null ? "–" : o.atr.toFixed(2)}</td>
                <td className="py-2 text-xs tabular-nums">
                  {plan ? (
                    <>
                      <span className="whitespace-nowrap">SL {price(plan.stop)}</span> <span className="whitespace-nowrap text-muted-foreground">· T {price(plan.target)}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">–</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
