"use client";

import { motion } from "framer-motion";

import AnimatedNumber from "@/components/averaging/AnimatedNumber";
import { RefreshIcon } from "@/components/icons";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  boardMood,
  byMoveDescending,
  moveIntensity,
  summarize,
  topMovers,
  type BoardEntry,
  type BoardFilter,
} from "@/lib/commodityBoard";
import { formatAsOf } from "@/lib/format";
import { commodityName } from "@/lib/mcxCommodities";
import type { CommodityInstrument } from "@/lib/types";
import { formatMovePct, moveDirection } from "@/lib/watchlist";

import { DIRECTION } from "./direction";
import { ChangePill, GlyphTile } from "./parts";

export type Feed = "loading" | "live" | "closed" | "paused";

type Props = {
  entries: readonly BoardEntry[];
  feed: Feed;
  /** When tonight's session ends in IST - shown while the market is open. */
  closesAt: string | null;
  lastPolledAt: number | null;
  refreshing: boolean;
  onRefresh: () => void;
  filter: BoardFilter;
  onFilter: (filter: BoardFilter) => void;
  onJump: (symbol: CommodityInstrument) => void;
};

const whole = (n: number) => String(Math.round(n));

/** The colour the hero's glow takes: the way the board as a whole is leaning, violet while it isn't leaning. */
function moodColor(avgPct: number | null): string {
  const mood = boardMood(avgPct);
  return mood === "up" ? "var(--profit)" : mood === "down" ? "var(--danger-fg)" : "var(--accent)";
}

function StatusPill({ feed, closesAt, hasPrices, tick }: { feed: Feed; closesAt: string | null; hasPrices: boolean; tick: number | null }) {
  const status = {
    live: { label: "Live", detail: closesAt ? `MCX closes ${closesAt}` : "MCX open", dot: "bg-profit" },
    closed: { label: "Closed", detail: "Last traded prices", dot: "bg-muted-foreground" },
    paused: { label: "Paused", detail: hasPrices ? "Last prices shown" : "No prices yet", dot: "bg-warning" },
    loading: { label: "Connecting", detail: "Fetching prices", dot: "bg-muted-foreground animate-pulse" },
  }[feed];

  return (
    <span className="inline-flex min-w-0 items-center gap-2 rounded-full border border-border bg-background/60 px-3 py-1.5 text-xs backdrop-blur-md sm:gap-2.5 sm:px-3.5">
      <span className="relative flex size-2 shrink-0">
        {feed === "live" && <span key={tick ?? 0} className={`sync-ping absolute inset-0 rounded-full ${status.dot}`} />}
        <span className={`relative size-2 rounded-full ${status.dot}`} />
      </span>
      <span className={`font-semibold ${feed === "paused" ? "text-warning-strong" : ""}`}>{status.label}</span>
      <span className="truncate text-muted-foreground">{status.detail}</span>
    </span>
  );
}

function Count({ n, label, className }: { n: number | null; label: string; className: string }) {
  return (
    <div>
      <div className={`text-4xl font-semibold leading-none tabular-nums sm:text-5xl ${className}`}>
        <AnimatedNumber value={n} format={whole} />
      </div>
      <div className="mt-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

/**
 * One cell per contract, strongest riser on the left to strongest faller on the right, each tinted by the size of its move.
 * It reads as breadth at a glance - and each cell is a way into its card. Colour is never alone: the counts above and the
 * cell's own label (on hover or focus, and to a screen reader) give the numbers.
 */
function Mosaic({ entries, onJump }: { entries: readonly BoardEntry[]; onJump: (symbol: CommodityInstrument) => void }) {
  const ordered = byMoveDescending(entries);
  const maxAbs = ordered.reduce((max, { quote }) => Math.max(max, Math.abs(quote?.changePct ?? 0)), 0);

  return (
    <ul className="mt-5 flex gap-[3px]" aria-label="Every contract, from the biggest riser to the biggest faller">
      {ordered.map(({ symbol, quote }, i) => {
        const direction = moveDirection(quote?.changePct ?? null);
        const strength = moveIntensity(quote?.changePct ?? null, maxAbs);
        const tint = direction === "up" ? "var(--profit)" : "var(--danger-fg)";
        const move = quote?.changePct != null ? formatMovePct(quote.changePct) : "no quote yet";
        return (
          <motion.li key={symbol} layout="position" transition={{ type: "spring", stiffness: 380, damping: 36 }} className="group/cell relative min-w-0 flex-1">
            <button
              type="button"
              onClick={() => onJump(symbol)}
              aria-label={`${commodityName(symbol)}, ${move}. Show it below`}
              className={`block h-10 w-full rounded-md transition-[transform,filter,background-color] duration-500 hover:-translate-y-0.5 hover:brightness-125 pointer-coarse:pointer-events-none sm:h-11 ${quote ? "" : "border border-dashed border-border-strong"}`}
              style={{ backgroundColor: direction === "flat" ? "var(--muted)" : `color-mix(in srgb, ${tint} ${Math.round(strength * 100)}%, var(--muted))` }}
            />
            <span
              aria-hidden="true"
              className={`pointer-events-none absolute bottom-full z-20 mb-2 hidden w-max max-w-[12rem] rounded-lg bg-foreground px-2.5 py-1.5 text-xs text-background shadow-lg group-focus-within/cell:block group-hover/cell:block ${
                i < 4 ? "left-0" : i > ordered.length - 5 ? "right-0" : "left-1/2 -translate-x-1/2"
              }`}
            >
              <span className="font-semibold">{commodityName(symbol)}</span> <span className="tabular-nums">{move}</span>
            </span>
          </motion.li>
        );
      })}
    </ul>
  );
}

function Leader({ label, entry, onJump }: { label: string; entry: BoardEntry | null; onJump: (symbol: CommodityInstrument) => void }) {
  if (!entry) {
    return (
      <div className="flex min-h-[3.25rem] items-center gap-3 px-2 py-1.5 text-sm text-muted-foreground">
        <span className="size-9 shrink-0 rounded-[10px] border border-dashed border-border-strong" aria-hidden="true" />
        <span>
          <span className="block text-[11px] font-medium uppercase tracking-wider">{label}</span>
          <span className="block">None yet</span>
        </span>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onJump(entry.symbol)}
      className="flex min-h-[3.25rem] w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-muted/60"
    >
      <GlyphTile symbol={entry.symbol} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className="block truncate text-sm font-semibold">{commodityName(entry.symbol)}</span>
      </span>
      <ChangePill quote={entry.quote} />
    </button>
  );
}

/** The hero: is the market open and live, how many contracts are up and down, who is leading, and a way to narrow to one sector. */
export default function MarketPulse({ entries, feed, closesAt, lastPolledAt, refreshing, onRefresh, filter, onFilter, onJump }: Props) {
  const all = summarize(entries, "all");
  const { gainer, loser } = topMovers(entries);
  const quoted = all.quoted > 0;
  const tiles: { key: BoardFilter; label: string }[] = [{ key: "all", label: "All contracts" }, ...CATEGORIES.map((category) => ({ key: category, label: CATEGORY_LABELS[category] }))];

  return (
    <section aria-labelledby="commodities-title" className="relative rounded-3xl border border-border bg-card">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl">
        <div className="absolute -left-28 -top-32 size-[28rem] rounded-full opacity-[0.22] blur-3xl transition-colors duration-1000" style={{ background: moodColor(all.avgPct) }} />
        <div className="absolute -right-24 -top-36 size-80 rounded-full bg-accent opacity-[0.12] blur-3xl" />
      </div>

      <div className="relative p-4 sm:p-7">
        <div className="flex items-center justify-between gap-3">
          <StatusPill feed={feed} closesAt={closesAt} hasPrices={quoted} tick={lastPolledAt} />
          <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            {lastPolledAt !== null && (
              <span className="tabular-nums">
                <span className="hidden sm:inline">Updated </span>
                {formatAsOf(lastPolledAt)}
              </span>
            )}
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              aria-label="Refresh prices"
              title="Refresh now"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
            >
              <RefreshIcon className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        <h1 id="commodities-title" className="mt-5 text-3xl font-semibold tracking-tight sm:mt-6 sm:text-4xl">
          Commodities
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">MCX futures — energy and metals</p>

        <div className="mt-6 grid gap-x-10 gap-y-5 sm:mt-7 sm:gap-y-7 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-end">
          <div>
            <div className="flex items-end gap-7 sm:gap-10">
              <Count n={quoted ? all.up : null} label="Rising" className="text-profit" />
              <Count n={quoted ? all.down : null} label="Falling" className="text-danger-fg" />
              <Count n={quoted ? all.flat : null} label="Flat" className="text-muted-foreground" />
              <span className="ml-auto pb-0.5 text-right text-xs text-muted-foreground">{quoted ? `${all.quoted} of ${all.count} quoted` : `${all.count} contracts`}</span>
            </div>
            <Mosaic entries={entries} onJump={onJump} />
          </div>
          <div className="-mx-2 flex flex-col gap-1">
            <Leader label="Leading" entry={gainer} onJump={onJump} />
            <Leader label="Lagging" entry={loser} onJump={onJump} />
          </div>
        </div>
      </div>

      <div role="group" aria-label="Show a sector" className="relative grid grid-cols-2 overflow-hidden rounded-b-3xl border-t border-border/70 sm:grid-cols-4">
        {tiles.map(({ key, label }, i) => {
          const summary = summarize(entries, key);
          const direction = moveDirection(summary.avgPct);
          const active = filter === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onFilter(key)}
              aria-pressed={active}
              className={`relative flex flex-col items-start gap-0.5 px-4 py-3 text-left transition-colors hover:bg-muted/60 sm:gap-1 sm:px-5 sm:py-4 ${active ? "bg-muted/70" : ""} ${i % 2 === 1 ? "border-l border-border/70" : ""} ${
                i >= 2 ? "border-t border-border/70 sm:border-t-0" : ""
              } ${i > 0 ? "sm:border-l sm:border-border/70" : ""}`}
            >
              <span aria-hidden="true" className={`absolute inset-x-0 top-0 h-0.5 bg-accent transition-opacity duration-200 ${active ? "opacity-100" : "opacity-0"}`} />
              <span className="text-xs font-medium text-muted-foreground">{label}</span>
              <span className={`text-xl font-semibold tabular-nums ${DIRECTION[direction].text}`}>
                <AnimatedNumber value={summary.avgPct} format={formatMovePct} />
              </span>
              <span className="text-xs text-muted-foreground">
                {summary.quoted > 0 ? `${summary.up} up · ${summary.down} down${summary.flat > 0 ? ` · ${summary.flat} flat` : ""}` : `${summary.count} contracts`}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
