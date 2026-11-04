"use client";

/**
 * The "Average price" card, and the whole idea of averaging on one line. The
 * headline figure and its change come first, like the other tiles; under them a
 * price ruler with three marks: what you'd pay now (the diamond), your average
 * today (the ring) and the average after buying (the dot), joined by a bar that
 * is green when the average falls and red when it rises. Positions are
 * percentages of the ruler, so it needs no measuring and fits any width; the key
 * underneath carries the exact numbers. With nothing to buy there's no ruler and
 * it's just the tile.
 *
 * Given room (about 28rem) the figure and the ruler sit side by side with a
 * hairline between, so the card is no taller than the plain tiles next to it;
 * narrower, the ruler goes underneath.
 */

import type { ReactNode } from "react";

import { num } from "@/components/averaging/ui";

export default function AveragePriceCard({
  value,
  chip,
  before,
  after,
  buy,
  className = "",
}: {
  /** The new average, as the big figure. */
  value: ReactNode;
  /** The change in it, as a chip. */
  chip?: ReactNode;
  before: number;
  after: number;
  /** The simulated buy price; null when there's nothing to buy, which hides the ruler. */
  buy: number | null;
  className?: string;
}) {
  const lowered = after < before - 0.005;
  const raised = after > before + 0.005;

  return (
    <div className={`@container flex min-w-0 flex-col rounded-xl border border-border bg-background p-3.5 ${className}`}>
      <div className={`grid gap-3 ${buy !== null ? "@min-[28rem]:grid-cols-[auto_minmax(0,1fr)] @min-[28rem]:gap-x-5" : ""}`}>
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">Average price</p>
          {/* Never truncated — a clipped price is a wrong price — so the size steps down with the card's own width instead. */}
          <p className="mt-1 whitespace-nowrap font-mono text-lg font-semibold tabular-nums @min-[7rem]:text-xl @min-[8.5rem]:text-2xl">{value}</p>
          <div className="mt-1.5 flex min-h-6 items-center">{chip}</div>
          <p className="mt-1 whitespace-nowrap text-xs text-muted-foreground">
            was <span className="font-mono tabular-nums">{num(before)}</span>
          </p>
        </div>

        {buy !== null && <Ruler before={before} after={after} buy={buy} lowered={lowered} raised={raised} />}
      </div>
    </div>
  );
}

function Ruler({ before, after, buy, lowered, raised }: { before: number; after: number; buy: number; lowered: boolean; raised: boolean }) {
  const low = Math.min(before, after, buy);
  const high = Math.max(before, after, buy);
  // Room either side of the marks; never a zero-width ruler when they all coincide.
  const span = Math.max(high - low, Math.abs(high) * 0.02, 0.5);
  const from = low - span * 0.3;
  const to = high + span * 0.3;
  const at = (v: number) => ((v - from) / (to - from)) * 100;

  const barLeft = at(Math.min(before, after));
  const barWidth = Math.abs(at(after) - at(before));
  const barColor = lowered ? "bg-profit" : raised ? "bg-danger-fg" : "bg-muted-foreground/50";

  const summary =
    `Buying at ${num(buy)} moves your average from ${num(before)} to ${num(after)}` +
    (lowered ? " — lower." : raised ? " — higher." : " — unchanged.");

  // The marks glide as the lots or the price change.
  const glide = "transition-[left] duration-300 motion-reduce:transition-none";

  return (
    <div
      role="img"
      aria-label={summary}
      className="flex min-w-0 flex-col justify-center border-t border-border pt-3 @min-[28rem]:border-l @min-[28rem]:border-t-0 @min-[28rem]:pl-5 @min-[28rem]:pt-0"
    >
      <div aria-hidden="true" className="relative mt-1 h-11">
        {/* the ruler and the stretch your average travels */}
        <div className="absolute inset-x-0 top-8 h-1 -translate-y-1/2 rounded-full bg-muted" />
        <div
          className={`absolute top-8 h-1.5 -translate-y-1/2 rounded-full transition-[left,width] duration-300 motion-reduce:transition-none ${barColor}`}
          style={{ left: `${barLeft}%`, width: `${barWidth}%` }}
        />
        {/* buy price: a diamond above the ruler, pointing down at it */}
        <span className={`absolute top-1 size-3 -translate-x-1/2 rotate-45 rounded-[3px] bg-foreground ${glide}`} style={{ left: `${at(buy)}%` }} />
        <span className={`absolute top-[1.1rem] h-2.5 w-px -translate-x-1/2 bg-foreground/50 ${glide}`} style={{ left: `${at(buy)}%` }} />
        {/* average now: a ring */}
        <span
          className={`absolute top-8 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-muted-foreground bg-background ${glide}`}
          style={{ left: `${at(before)}%` }}
        />
        {/* average after: a dot */}
        <span
          className={`absolute top-8 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-solid ring-2 ring-background ${glide}`}
          style={{ left: `${at(after)}%` }}
        />
      </div>

      <dl aria-hidden="true" className="mt-1 grid grid-cols-3 gap-2 text-xs">
        <div className="min-w-0">
          <dt className="flex items-center gap-1.5 text-muted-foreground">
            <span className="size-2 shrink-0 rotate-45 rounded-[2px] bg-foreground" />
            Buy at
          </dt>
          <dd className="mt-0.5 font-mono text-sm font-semibold tabular-nums">{num(buy)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="flex items-center gap-1.5 text-muted-foreground">
            <span className="size-2.5 shrink-0 rounded-full border-2 border-muted-foreground" />
            Average now
          </dt>
          <dd className="mt-0.5 font-mono text-sm font-semibold tabular-nums">{num(before)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="flex items-center gap-1.5 text-muted-foreground">
            <span className="size-2 shrink-0 rounded-full bg-accent-solid" />
            New average
          </dt>
          <dd className="mt-0.5 font-mono text-sm font-semibold tabular-nums">{num(after)}</dd>
        </div>
      </dl>
    </div>
  );
}
