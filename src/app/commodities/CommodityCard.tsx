"use client";

import { motion } from "framer-motion";

import { ChevronDownIcon } from "@/components/icons";
import { commodityTone, type BoardEntry } from "@/lib/commodityBoard";
import { commodityName, commodityUnit } from "@/lib/mcxCommodities";
import type { CommodityInstrument } from "@/lib/types";
import { moveDirection } from "@/lib/watchlist";

import { ChangePill, DayRange, GlyphTile, MoveText, PriceFigure } from "./parts";
import Sparkline from "./Sparkline";
import { usePriceFlash } from "./usePriceFlash";

export type ItemProps = {
  entry: BoardEntry;
  /** The recent prices, oldest first - the trace. */
  spark: readonly number[];
  /** Whether a change in price is a live tick worth flashing (false while the market is shut or the feed is paused). */
  live: boolean;
  /** Holding last-known prices through an outage. */
  stale: boolean;
  /** Just jumped to from the strip at the top: ring it for a moment. */
  spotlight: boolean;
  /** Position in the list, for the staggered entrance. */
  index: number;
  /** Open this contract's pop-up (lot size, open, volume). */
  onOpen: (symbol: CommodityInstrument) => void;
};

/** The entrance every item makes, and how it slides to a new place when the order changes. */
export function itemMotion(index: number) {
  return {
    initial: { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.35, delay: Math.min(index, 10) * 0.035, ease: [0.22, 1, 0.36, 1] as const, layout: { type: "spring" as const, stiffness: 380, damping: 36 } },
  };
}

/** One contract as a card: its mark and name, the price and move, a live trace, where the price sits in the day - and, in a pop-up, the lot. */
export default function CommodityCard({ entry, spark, live, stale, spotlight, index, onOpen }: ItemProps) {
  const { symbol, quote } = entry;
  const direction = moveDirection(quote?.changePct ?? null);
  const flash = usePriceFlash(quote?.price, live);
  const tone = commodityTone(symbol);
  const unit = commodityUnit(symbol);

  return (
    <motion.li id={`commodity-${symbol}`} layout="position" {...itemMotion(index)} className="scroll-mt-24 list-none">
      <div
        className={`group relative h-full overflow-hidden rounded-2xl border bg-card transition-[transform,box-shadow,border-color,opacity] duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-xl hover:shadow-black/10 ${
          spotlight ? "border-accent ring-2 ring-accent/60" : "border-border"
        } ${stale ? "opacity-[0.85]" : ""}`}
      >
        {/* The metal's halo, behind everything, and a hairline across the top that takes the move's colour. */}
        <span aria-hidden="true" className="pointer-events-none absolute -left-12 -top-14 size-48 rounded-full opacity-[0.13] blur-3xl" style={{ background: tone.glow }} />
        <span aria-hidden="true" className={`pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r to-transparent ${direction === "up" ? "from-profit" : direction === "down" ? "from-danger-fg" : "from-border-strong"}`} />

        <div className="relative flex items-start gap-3 p-4 pb-0">
          <GlyphTile symbol={symbol} />
          <div className="min-w-0 flex-1 pt-0.5">
            <h3 className="truncate text-[15px] font-semibold leading-tight">{commodityName(symbol)}</h3>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="font-mono">{symbol}</span>
              {quote?.contract && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{quote.contract.label}</span>
                </>
              )}
            </p>
          </div>
          <ChangePill quote={quote} />
        </div>

        <div className="relative flex items-end justify-between gap-3 px-4 pt-5">
          <div className="min-w-0">
            <PriceFigure price={quote?.price} flash={flash} className={`text-[26px] leading-none tracking-tight ${quote ? "" : "text-muted-foreground"}`} />
            <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
              {quote && quote.change !== null ? (
                <>
                  <MoveText quote={quote} />
                  <span>today</span>
                </>
              ) : (
                <span>{quote ? "Move shows once it has traded" : "Waiting for a quote"}</span>
              )}
              {unit && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{unit}</span>
                </>
              )}
            </p>
          </div>
          <Sparkline prices={spark} direction={direction} />
        </div>

        <div className="relative px-4 pb-4 pt-5">{quote ? <DayRange quote={quote} /> : <div className="h-[30px]" aria-hidden="true" />}</div>

        {quote ? (
          <button
            type="button"
            onClick={() => onOpen(symbol)}
            aria-haspopup="dialog"
            aria-label={`${commodityName(symbol)}: lot size, open and volume`}
            className="relative flex w-full items-center justify-between border-t border-border/60 px-4 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <span>Lot size, open &amp; volume</span>
            <ChevronDownIcon className="size-4 -rotate-90 transition-transform duration-200 group-hover:translate-x-0.5" />
          </button>
        ) : (
          <div aria-hidden="true" className="min-h-[37px] border-t border-border/60 pointer-coarse:min-h-[44px]" />
        )}
      </div>
    </motion.li>
  );
}
