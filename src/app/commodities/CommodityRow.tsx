"use client";

import { motion } from "framer-motion";

import { ChevronDownIcon } from "@/components/icons";
import { commodityName, commodityUnit } from "@/lib/mcxCommodities";
import { moveDirection } from "@/lib/watchlist";

import { itemMotion, type ItemProps } from "./CommodityCard";
import { ChangePill, GlyphTile, PriceFigure } from "./parts";
import Sparkline from "./Sparkline";
import { usePriceFlash } from "./usePriceFlash";

/** One contract as a row, for scanning the whole board at once: mark, name, trace, price, move - with the same pop-up one tap away. */
export default function CommodityRow({ entry, spark, live, stale, spotlight, index, onOpen }: ItemProps) {
  const { symbol, quote } = entry;
  const direction = moveDirection(quote?.changePct ?? null);
  const flash = usePriceFlash(quote?.price, live);
  const unit = commodityUnit(symbol);

  const identity = (
    <>
      <GlyphTile symbol={symbol} size="sm" />
      <span className="min-w-0 text-left">
        <span className="block truncate text-sm font-semibold leading-tight">{commodityName(symbol)}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="font-mono">{symbol}</span>
          {quote?.contract && (
            <>
              <span aria-hidden="true">·</span>
              <span className="truncate">{quote.contract.label}</span>
            </>
          )}
        </span>
      </span>
    </>
  );

  return (
    <motion.li id={`commodity-${symbol}`} layout="position" {...itemMotion(index)} className={`scroll-mt-24 list-none ${spotlight ? "bg-accent/10" : ""} ${stale ? "opacity-[0.85]" : ""} transition-colors`}>
      {quote ? (
        <button
          type="button"
          onClick={() => onOpen(symbol)}
          aria-haspopup="dialog"
          className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-3 transition-colors hover:bg-muted/50 sm:grid-cols-[auto_minmax(0,1fr)_auto_minmax(7.5rem,auto)_auto_auto] sm:px-4"
        >
          {identity}
          <Sparkline prices={spark} direction={direction} className="hidden h-8 w-20 sm:block" />
          <span className="flex flex-col items-end gap-1.5 sm:contents">
            <span className="block text-right">
              <PriceFigure price={quote.price} flash={flash} className="text-[15px] leading-none" />
              {unit && <span className="mt-1 hidden text-[11px] text-muted-foreground sm:block">{unit}</span>}
            </span>
            <ChangePill quote={quote} />
          </span>
          <ChevronDownIcon className="hidden size-4 -rotate-90 text-muted-foreground sm:block" />
        </button>
      ) : (
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-3 sm:px-4">
          {identity}
          <ChangePill quote={quote} />
        </div>
      )}
    </motion.li>
  );
}
