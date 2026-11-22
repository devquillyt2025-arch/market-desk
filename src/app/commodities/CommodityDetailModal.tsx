"use client";

import { XIcon } from "@/components/icons";
import Modal from "@/components/Modal";
import { commodityTone } from "@/lib/commodityBoard";
import { commodityName, commodityUnit } from "@/lib/mcxCommodities";
import type { CommodityInstrument } from "@/lib/types";
import { moveDirection, type WatchQuote } from "@/lib/watchlist";

import { ChangePill, CommodityDetails, DayRange, GlyphTile, MoveText, PriceFigure } from "./parts";
import Sparkline from "./Sparkline";
import { usePriceFlash } from "./usePriceFlash";

type Props = {
  symbol: CommodityInstrument;
  /** The contract's current quote - the pop-up stays live, so this changes while it is open. */
  quote: WatchQuote;
  /** The recent prices, oldest first - the trace. */
  spark: readonly number[];
  /** Whether a change in price is a live tick worth flashing. */
  live: boolean;
  onClose: () => void;
};

/**
 * One contract in a pop-up: the price and its move up top, then where it sits in the day, then the facts a trader sizes a
 * trade by - the open, yesterday's close, volume, and the lot (what it is, what it is worth, and what a ₹1 move does to it).
 * A bottom sheet on a phone, a centred card on a wider screen (the shared Modal).
 */
export default function CommodityDetailModal({ symbol, quote, spark, live, onClose }: Props) {
  const titleId = `commodity-${symbol}-title`;
  const direction = moveDirection(quote.changePct);
  const flash = usePriceFlash(quote.price, live);
  const tone = commodityTone(symbol);
  const unit = commodityUnit(symbol);

  return (
    <Modal onClose={onClose} ariaLabelledBy={titleId} className="flex sm:max-w-md flex-col">
      <div className="relative overflow-hidden border-b border-border px-5 py-4">
        {/* The metal's halo, as on its card. */}
        <span aria-hidden="true" className="pointer-events-none absolute -left-10 -top-14 size-44 rounded-full opacity-[0.16] blur-3xl" style={{ background: tone.glow }} />
        <div className="relative flex items-center gap-3">
          <GlyphTile symbol={symbol} />
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="truncate text-lg font-semibold leading-tight tracking-tight">
              {commodityName(symbol)}
            </h2>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="font-mono">{symbol}</span>
              {quote.contract && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{quote.contract.label}</span>
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <XIcon className="size-4" />
          </button>
        </div>
      </div>

      <div className="px-5 pt-5">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <PriceFigure price={quote.price} flash={flash} className="text-[32px] leading-none tracking-tight" />
            <p className="mt-2.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
              {quote.change !== null ? (
                <>
                  <MoveText quote={quote} />
                  <span>today</span>
                </>
              ) : (
                <span>Move shows once it has traded</span>
              )}
              {unit && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{unit}</span>
                </>
              )}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <ChangePill quote={quote} />
            <Sparkline prices={spark} direction={direction} className="h-12 w-28" />
          </div>
        </div>
        <div className="pt-5">
          <DayRange quote={quote} />
        </div>
      </div>

      <CommodityDetails symbol={symbol} quote={quote} className="mt-5 border-t border-border px-5 pb-5 pt-4" />
    </Modal>
  );
}
