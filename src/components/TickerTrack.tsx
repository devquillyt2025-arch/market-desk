"use client";

/**
 * The row of prices in the ticker across the top of every page. It slides endlessly, left, when there are more prices than fit and
 * the reader hasn't turned the loop off; otherwise it sits still and scrolls by hand, as the strip always has.
 *
 * The loop is two identical copies of the row side by side, slid left by exactly one copy and started over - so the join never
 * shows (see `.ticker-run` in globals.css). The second copy is for the eye only: it is hidden from screen readers, and it is not
 * there at all when the row isn't looping. It holds still while the pointer or the keyboard is on it, can be paused with the
 * button beside it (a phone has no hover), and never moves for someone whose system asks for reduced motion.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { PauseIcon, PlayIcon } from "@/components/icons";
import { formatPct, pnlColorClass } from "@/lib/format";
import { tickerLoopSeconds, type TickerSource } from "@/lib/tickerPrefs";
import type { TickerEntry } from "@/lib/tickerStrip";

/** The space between two prices (`gap-x-6`), and the same again at the end of a copy so the two copies join evenly (`pr-6`). */
const GAP_PX = 24;

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(callback: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia(REDUCED_MOTION).matches, () => false);
}

function Tile({ entry, loading }: { entry: TickerEntry; loading: boolean }) {
  const closed = entry.open === false;
  return (
    // Not dimmed when the market is shut: these are read at night and on weekends, and fading the figures took them below readable
    // contrast. A small hollow ring says "closed" instead, and the tooltip says how old the price is.
    <li title={entry.tooltip} className="flex shrink-0 items-baseline gap-1.5">
      {closed && <span aria-hidden="true" className="size-1.5 shrink-0 self-center rounded-full border border-muted-foreground" />}
      <span className="text-muted-foreground">{entry.label}</span>
      {entry.price !== null ? (
        <span className="font-semibold tabular-nums text-foreground">{entry.price}</span>
      ) : loading ? (
        <span className="h-3 w-14 animate-pulse self-center rounded bg-muted" />
      ) : (
        <span className="font-semibold text-foreground">—</span>
      )}
      {entry.percent !== null && <span className={`tabular-nums ${pnlColorClass(entry.percent)}`}>{formatPct(entry.percent, 2)}</span>}
      {closed && <span className="sr-only">(market closed)</span>}
    </li>
  );
}

const ROW_CLASS = "flex shrink-0 items-center gap-x-6 whitespace-nowrap pr-6";

export default function TickerTrack({
  entries,
  loading,
  loop,
  speed,
}: {
  entries: readonly TickerEntry[];
  /** Per feed: it has not answered yet, so a price missing from it is on its way rather than missing. */
  loading: Readonly<Record<TickerSource, boolean>>;
  loop: boolean;
  /** Pixels a second. */
  speed: number;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLUListElement>(null);
  const [size, setSize] = useState({ row: 0, viewport: 0 });
  const [paused, setPaused] = useState(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const viewport = viewportRef.current;
    const row = rowRef.current;
    if (!viewport || !row) return;
    const measure = () => {
      const next = { row: row.offsetWidth, viewport: viewport.clientWidth };
      setSize((prev) => (prev.row === next.row && prev.viewport === next.viewport ? prev : next));
    };
    // Fires once on observing, and again whenever the row grows (a price gains a digit) or the window is resized.
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  // Only when there is more than fits: a row that fits stays still, and a hidden second copy would just be a repeat on screen.
  const looping = loop && !reduceMotion && size.viewport > 0 && size.row - GAP_PX > size.viewport;

  const tiles = entries.map((entry) => <Tile key={entry.id} entry={entry} loading={loading[entry.source]} />);

  return (
    <>
      <div
        ref={viewportRef}
        className={`ticker-viewport min-w-0 flex-1 ${
          looping
            ? "overflow-hidden [mask-image:linear-gradient(to_right,transparent,#000_20px,#000_calc(100%-20px),transparent)]"
            : // Scrolls sideways by hand when the window is too narrow for every price; the fade on the right edge says there is more.
              "overflow-x-auto [mask-image:linear-gradient(to_right,#000_calc(100%-28px),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        }`}
      >
        <div
          className={`flex w-max ${looping ? "ticker-run" : ""}`}
          style={looping ? { animationDuration: `${tickerLoopSeconds(size.row, speed)}s`, animationPlayState: paused ? "paused" : undefined } : undefined}
        >
          <ul ref={rowRef} aria-label="Prices" className={ROW_CLASS}>
            {tiles}
          </ul>
          {looping && (
            <ul aria-hidden="true" className={ROW_CLASS}>
              {tiles}
            </ul>
          )}
        </div>
      </div>
      {looping && (
        <button
          type="button"
          onClick={() => setPaused((value) => !value)}
          aria-label={paused ? "Resume the ticker" : "Pause the ticker"}
          title={paused ? "Resume the ticker" : "Pause the ticker"}
          data-compact=""
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {paused ? <PlayIcon className="size-4" /> : <PauseIcon className="size-4" />}
        </button>
      )}
    </>
  );
}
