"use client";

/**
 * The Dashboard's small parts: the card shell, the three band headings (Now / Done / Next), and the little figures the cards are built
 * from - a day-range bar, a split bar, a win-rate ring, the daily P&L bars. Nothing here fetches; every figure arrives as a prop,
 * and colour is never the only signal (a sign, an arrow or a number always comes with it).
 */

import { motion } from "framer-motion";
import Link from "next/link";
import type { ReactNode } from "react";

import { DIRECTION } from "@/app/commodities/direction";
import { signedMoney } from "@/app/commodities/natgasFormat";
import { rangeGauge } from "@/lib/commodityBoard";
import type { DayBar } from "@/lib/dashboardBrief";
import { dayLabel } from "@/lib/dashboardBrief";
import { formatMovePct, moveDirection, type WatchQuote } from "@/lib/watchlist";

export const TITLE = "text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground";

/** A figure that isn't there (yet). */
export function NA() {
  return <span className="text-muted-foreground">—</span>;
}

export function Skeleton({ className = "h-4 w-16" }: { className?: string }) {
  return <span aria-hidden="true" className={`block animate-pulse rounded bg-muted ${className}`} />;
}

function Arrow() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-3 transition-transform duration-200 group-hover/title:translate-x-0.5" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

/** One card: a heading that is the way into its tab, a figure or two for `meta`, and the body. `index` staggers the entrance. */
export function Card({ title, href, meta, index = 0, className = "", children }: { title: string; href?: string; meta?: ReactNode; index?: number; className?: string; children: ReactNode }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: Math.min(index, 12) * 0.04, ease: "easeOut" }}
      className={`relative flex min-w-0 flex-col rounded-2xl border border-border bg-card p-4 ${className}`}
    >
      <div className="flex min-h-6 items-center justify-between gap-3">
        <h3 className={TITLE}>
          {href ? (
            <Link href={href} className="group/title -mx-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-1.5 transition-colors hover:text-foreground pointer-coarse:min-h-11">
              {title}
              <Arrow />
            </Link>
          ) : (
            title
          )}
        </h3>
        {meta !== undefined && <span className="min-w-0 truncate text-xs tabular-nums text-muted-foreground">{meta}</span>}
      </div>
      <div className="mt-2 flex flex-1 flex-col gap-3">{children}</div>
    </motion.section>
  );
}

const MARKERS = {
  now: "bg-profit",
  done: "bg-accent",
  next: "border-2 border-warning",
} as const;

export type Band = keyof typeof MARKERS;

/** "Now", "Done", "Next": a marker (filled and pinging, filled, hollow), the word, a rule, and one figure. */
export function BandHeader({ band, label, meta, tick }: { band: Band; label: string; meta?: ReactNode; tick?: number | null }) {
  return (
    <div className="flex items-center gap-3">
      <span className="relative flex size-2.5 shrink-0" aria-hidden="true">
        {band === "now" && <span key={tick ?? 0} className="sync-ping absolute inset-0 rounded-full bg-profit" />}
        <span className={`relative size-2.5 rounded-full ${MARKERS[band]}`} />
      </span>
      <h2 className="text-xs font-semibold uppercase tracking-[0.16em]">{label}</h2>
      <span aria-hidden="true" className="h-px flex-1 bg-gradient-to-r from-border-strong to-transparent" />
      {meta !== undefined && <span className="text-xs tabular-nums text-muted-foreground">{meta}</span>}
    </div>
  );
}

/** A label above a figure. */
export function Stat({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <div className="min-w-0" title={title}>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-[13px] font-semibold tabular-nums">{children}</dd>
    </div>
  );
}

/** A signed day's move in the direction's colour: the sign says it too. */
export function Move({ pct, className = "" }: { pct: number | null | undefined; className?: string }) {
  if (pct === null || pct === undefined) return <NA />;
  return <span className={`font-medium tabular-nums ${DIRECTION[moveDirection(pct)].text} ${className}`}>{formatMovePct(pct)}</span>;
}

/** A signed rupee amount, green or red. */
export function Money({ value, className = "" }: { value: number | null | undefined; className?: string }) {
  if (value === null || value === undefined) return <NA />;
  const tone = value > 0 ? "text-profit" : value < 0 ? "text-danger-fg" : "";
  return <span className={`tabular-nums ${tone} ${className}`}>{signedMoney(value)}</span>;
}

/** Today's low to high as a thin track, yesterday's close as a tick on it, the price as a pin - and the stretch between close and price in the move's colour. */
export function RangeBar({ quote }: { quote: WatchQuote }) {
  const gauge = rangeGauge(quote);
  if (!gauge) return <span aria-hidden="true" className="block h-1 flex-1 rounded-full bg-muted" />;
  const from = gauge.reference ?? gauge.price;
  const colour = DIRECTION[gauge.direction].fill;
  return (
    <span role="img" aria-label={`The price is ${Math.round(gauge.price * 100)}% of the way up today's range`} className="relative block h-1 flex-1 rounded-full bg-muted">
      <span className={`absolute inset-y-0 rounded-full opacity-70 ${colour}`} style={{ left: `${Math.min(from, gauge.price) * 100}%`, width: `${Math.abs(gauge.price - from) * 100}%` }} />
      {gauge.reference !== null && <span className="absolute -inset-y-[3px] w-px bg-muted-foreground/60" style={{ left: `${gauge.reference * 100}%` }} />}
      <span className={`absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card ${colour}`} style={{ left: `${gauge.price * 100}%` }} />
    </span>
  );
}

/** Up, flat and down as one bar, in proportion. */
export function SplitBar({ up, flat, down }: { up: number; flat: number; down: number }) {
  return (
    <span role="img" aria-label={`${up} up, ${flat} flat, ${down} down`} className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full bg-muted">
      {up > 0 && <span className="bg-profit" style={{ flex: up }} />}
      {flat > 0 && <span className="bg-muted-foreground/40" style={{ flex: flat }} />}
      {down > 0 && <span className="bg-danger-fg" style={{ flex: down }} />}
    </span>
  );
}

const RING_R = 20;
const RING_C = 2 * Math.PI * RING_R;

/** A share as a ring with its number in the middle. */
export function Ring({ pct, label }: { pct: number | null; label: string }) {
  const filled = pct === null ? 0 : Math.min(100, Math.max(0, pct));
  return (
    <span role="img" aria-label={pct === null ? `${label}: none` : `${label}: ${Math.round(pct)}%`} className="relative grid size-16 shrink-0 place-items-center">
      <svg viewBox="0 0 52 52" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx="26" cy="26" r={RING_R} fill="none" strokeWidth="5" className="stroke-muted" />
        <circle
          cx="26"
          cy="26"
          r={RING_R}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${(RING_C * filled) / 100} ${RING_C}`}
          className={`transition-[stroke-dasharray] duration-500 ${filled >= 50 ? "stroke-profit" : "stroke-danger-fg"}`}
        />
      </svg>
      <span className="text-sm font-semibold tabular-nums">{pct === null ? "—" : `${Math.round(pct)}%`}</span>
    </span>
  );
}

/**
 * Each weekday as one column: a gain rises above the centre line, a loss hangs below it, a day nothing closed on is a dot on the line.
 * Heights share one scale, so a bar is as tall as its day was big; the exact figure is on each column's title.
 */
export function DayBars({ bars, className = "h-16" }: { bars: readonly DayBar[]; className?: string }) {
  const maxAbs = bars.reduce((max, b) => Math.max(max, Math.abs(b.pnl ?? 0)), 0);
  const up = bars.filter((b) => (b.pnl ?? 0) > 0).length;
  const down = bars.filter((b) => (b.pnl ?? 0) < 0).length;
  return (
    <div role="img" aria-label={`Daily P&L over ${bars.length} weekdays: ${up} up, ${down} down`} className={`relative grid gap-[3px] ${className}`} style={{ gridTemplateColumns: `repeat(${Math.max(bars.length, 1)}, minmax(0, 1fr))` }}>
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-border-strong/60" />
      {bars.map((bar) => {
        const height = bar.pnl === null || maxAbs === 0 ? 0 : Math.max(8, (Math.abs(bar.pnl) / maxAbs) * 100);
        return (
          <span key={bar.date} title={`${dayLabel(bar.date)}  ${bar.pnl === null ? "no trades" : signedMoney(bar.pnl)}`} className="grid grid-rows-2">
            <span className="flex items-end">{bar.pnl !== null && bar.pnl > 0 && <span className="w-full rounded-t-[3px] bg-profit transition-[height] duration-500" style={{ height: `${height}%` }} />}</span>
            <span className="relative flex items-start">
              {bar.pnl === null && <span className="absolute left-1/2 top-0 size-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-border-strong" />}
              {bar.pnl !== null && bar.pnl < 0 && <span className="w-full rounded-b-[3px] bg-danger-fg transition-[height] duration-500" style={{ height: `${height}%` }} />}
            </span>
          </span>
        );
      })}
    </div>
  );
}
