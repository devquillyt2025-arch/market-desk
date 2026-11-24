"use client";

/**
 * Your natural gas positions as they would stand if MCX opens at the expected price: the book's total first, then one line per
 * position - what it is, what it makes now, and what it would make then. Plain markup on purpose; there is nothing here to animate.
 */

import Link from "next/link";

import { pnlColorClass } from "@/lib/format";
import type { PositionsAtOpen } from "@/lib/natgasDesk";

import { signedMoney } from "./natgasFormat";

export default function NatgasPositions({ result, held }: { result: PositionsAtOpen | null; held: number }) {
  return (
    <section aria-label="Your natural gas positions at the expected open" className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-sm font-semibold">Your positions at the expected open</h3>
        <Link href="/portfolio" className="text-xs font-medium text-accent underline-offset-2 hover:underline">
          Live Portfolio
        </Link>
      </div>

      {result === null ? (
        <div className="mt-3 space-y-2" aria-busy="true">
          <p className="sr-only">Pricing your {held === 1 ? "position" : `${held} positions`}…</p>
          {Array.from({ length: Math.min(held, 3) }, (_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-xl bg-muted/60" />
          ))}
        </div>
      ) : result.rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {result.skipped > 0 ? "Your natural gas positions can't be priced right now - the Live Portfolio says why." : "No natural gas positions to show."}
        </p>
      ) : (
        <>
          <p className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className={`text-2xl font-semibold tabular-nums ${pnlColorClass(result.totalAtOpen)}`}>{signedMoney(result.totalAtOpen)}</span>
            <span className="text-xs tabular-nums text-muted-foreground">
              at the open, from <span className={pnlColorClass(result.totalNow)}>{signedMoney(result.totalNow)}</span> now ·{" "}
              <span className={`font-semibold ${pnlColorClass(result.totalChange)}`}>{signedMoney(result.totalChange)}</span>
            </span>
          </p>
          <ul className="mt-2 divide-y divide-border/60">
            {result.rows.map((p) => (
              <li key={p.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{p.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <span className={`mr-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${p.side === "buy" ? "bg-profit/10 text-profit" : "bg-danger-fg/10 text-danger-fg"}`}>{p.side === "buy" ? "Bought" : "Sold"}</span>
                    {p.lots} {p.lots === 1 ? "lot" : "lots"} · now <span className={`tabular-nums ${pnlColorClass(p.pnlNow)}`}>{signedMoney(p.pnlNow)}</span>
                  </p>
                </div>
                <div className="shrink-0 text-right tabular-nums">
                  <p className={`text-base font-semibold ${pnlColorClass(p.pnlAtOpen)}`}>{signedMoney(p.pnlAtOpen)}</p>
                  <p className={`text-xs ${pnlColorClass(p.change)}`}>
                    {signedMoney(p.change)}
                    <span className="sr-only"> change</span>
                  </p>
                </div>
              </li>
            ))}
          </ul>
          {result.skipped > 0 && (
            <p className="mt-2 text-xs text-warning-strong">
              {result.skipped} natural gas {result.skipped === 1 ? "position" : "positions"} couldn&apos;t be priced and {result.skipped === 1 ? "is" : "are"} left out.
            </p>
          )}
        </>
      )}
      <p className="mt-3 text-xs text-muted-foreground">An estimate: options repriced at their own volatility, before charges.</p>
    </section>
  );
}
