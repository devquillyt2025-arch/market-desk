"use client";

import { commodityTone, lotFacts, rangeGauge } from "@/lib/commodityBoard";
import { commodityGlyph } from "@/lib/mcxCommodities";
import type { CommodityInstrument } from "@/lib/types";
import { formatMove, formatMovePct, formatPrice, formatRangeValue, moveDirection, type WatchQuote } from "@/lib/watchlist";

import { DIRECTION, MoveArrow } from "./direction";
import type { Flash } from "./usePriceFlash";

const wholeNumber = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** The contract's mark, struck on a tile of its own metal: Au on gold, Ag on silver, CL on a dark slab of crude. */
export function GlyphTile({ symbol, size = "md" }: { symbol: CommodityInstrument; size?: "sm" | "md" }) {
  const tone = commodityTone(symbol);
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center font-mono font-bold ${size === "md" ? "size-11 rounded-xl text-sm" : "size-9 rounded-[10px] text-xs"}`}
      style={{
        background: tone.surface,
        color: tone.ink,
        boxShadow: `inset 0 1px 0 rgb(255 255 255 / 0.5), inset 0 -3px 6px rgb(0 0 0 / 0.16), 0 8px 18px -8px ${tone.glow}`,
      }}
    >
      {commodityGlyph(symbol)}
    </span>
  );
}

/** "▲ +1.24%" - the day's move, as the answer to "how is it doing". */
export function ChangePill({ quote }: { quote: WatchQuote | undefined }) {
  if (!quote) {
    return <span className="inline-flex shrink-0 items-center rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground ring-1 ring-inset ring-border">No quote</span>;
  }
  if (quote.changePct === null) return null;
  const direction = moveDirection(quote.changePct);
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums ring-1 ring-inset ${DIRECTION[direction].pill}`}>
      <span className="sr-only">{DIRECTION[direction].label} </span>
      <MoveArrow direction={direction} />
      {formatMovePct(quote.changePct)}
    </span>
  );
}

/**
 * The price. Keyed on the tick count so each tick replays the wash of green or red behind the figure; the negative margin
 * and equal padding keep that wash from nudging the text.
 */
export function PriceFigure({ price, flash, className }: { price: number | undefined; flash: Flash; className: string }) {
  return (
    <span className={`block font-semibold tabular-nums ${className}`}>
      {price === undefined ? (
        "—"
      ) : (
        <span key={flash?.n ?? 0} className={`-mx-1 rounded-md px-1 ${flash ? (flash.dir === "up" ? "tick-up" : "tick-down") : ""}`}>
          {formatPrice("commodity", price)}
        </span>
      )}
    </span>
  );
}

/** Today's low to high as a track, yesterday's close as a tick on it, the price as a pin - and the stretch between close and price filled in the move's colour. */
export function DayRange({ quote }: { quote: WatchQuote }) {
  const gauge = rangeGauge(quote);
  if (!gauge || quote.low === null || quote.high === null) {
    return <p className="text-xs text-muted-foreground">Day range shows once it has traded</p>;
  }
  const reference = gauge.reference ?? gauge.price;
  return (
    <div role="img" aria-label={`Today's range ₹${formatRangeValue(quote.low)} to ₹${formatRangeValue(quote.high)}; the price is ${Math.round(gauge.price * 100)}% of the way up`}>
      <div className="mb-2 flex justify-between text-[11px] tabular-nums text-muted-foreground">
        <span>
          <span className="mr-1 text-[10px] font-medium uppercase tracking-wider opacity-70">Low</span>₹{formatRangeValue(quote.low)}
        </span>
        <span>
          <span className="mr-1 text-[10px] font-medium uppercase tracking-wider opacity-70">High</span>₹{formatRangeValue(quote.high)}
        </span>
      </div>
      <div className="relative h-1.5 rounded-full bg-muted">
        <span
          className={`absolute inset-y-0 rounded-full opacity-60 transition-[left,width] duration-500 ease-out ${DIRECTION[gauge.direction].fill}`}
          style={{ left: `${Math.min(gauge.price, reference) * 100}%`, width: `${Math.abs(gauge.price - reference) * 100}%` }}
        />
        {gauge.reference !== null && (
          <span className="absolute top-1/2 h-3.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/60" style={{ left: `${gauge.reference * 100}%` }} />
        )}
        <span
          className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-foreground shadow-md transition-[left] duration-500 ease-out"
          style={{ left: `${gauge.price * 100}%` }}
        />
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string | null }) {
  if (value === null) return null;
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-[13px] font-medium tabular-nums">{value}</dd>
    </div>
  );
}

/** What the pop-up lists: the open, yesterday's close, volume, and the lot. `className` is the caller's padding and borders. */
export function CommodityDetails({ symbol, quote, className = "" }: { symbol: CommodityInstrument; quote: WatchQuote; className?: string }) {
  const lot = lotFacts(symbol, quote.price);
  return (
    <dl className={`grid grid-cols-2 gap-x-6 gap-y-4 ${className}`}>
      <Fact label="Open" value={quote.open !== null ? formatPrice("commodity", quote.open) : null} />
      <Fact label="Previous close" value={quote.prevClose !== null ? formatPrice("commodity", quote.prevClose) : null} />
      <Fact label="Volume" value={quote.volume !== null ? wholeNumber.format(quote.volume) : null} />
      <Fact label="Lot size" value={lot.contractSize} />
      <Fact label="Lot value" value={`₹${wholeNumber.format(lot.lotValue)}`} />
      <Fact label="Per ₹1 move" value={`₹${wholeNumber.format(lot.perRupee)}`} />
    </dl>
  );
}

/** Today's move in rupees, signed, in the move's colour. */
export function MoveText({ quote }: { quote: WatchQuote }) {
  if (quote.change === null) return null;
  const direction = moveDirection(quote.changePct);
  return <span className={`tabular-nums ${DIRECTION[direction].text}`}>{formatMove(quote.change)}</span>;
}
