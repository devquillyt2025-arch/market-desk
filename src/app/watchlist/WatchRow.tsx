"use client";

import { useEffect, useState, type DragEvent, type KeyboardEvent } from "react";

import { ChevronDownIcon, GripVerticalIcon, TrashIcon, TrendingDownIcon, TrendingUpIcon } from "@/components/icons";
import {
  dayRangePosition,
  formatMove,
  formatMovePct,
  formatPrice,
  formatRangeValue,
  itemDetail,
  itemGlyph,
  moveDirection,
  type WatchQuote,
  type WatchlistItem,
} from "@/lib/watchlist";

import { toneStyle } from "./watchTone";

const FLASH_MS = 800;

/**
 * Which way the price last ticked, for a moment after each change - the cue that a number on screen is live. Derived while
 * rendering (React's "adjust state when a prop changes" pattern) rather than in an effect, so there is no frame
 * where the new price shows without its flash. Nothing flashes on the first price, or when a stale price is
 * replaced by a live one (`quiet`): that is a refresh, not a tick.
 */
function useTickFlash(price: number | undefined, quiet: boolean): { dir: "up" | "down"; on: boolean } {
  const [seen, setSeen] = useState(price);
  const [flash, setFlash] = useState<{ dir: "up" | "down"; on: boolean }>({ dir: "up", on: false });

  if (price !== seen) {
    setSeen(price);
    if (price !== undefined && seen !== undefined && !quiet) setFlash({ dir: price > seen ? "up" : "down", on: true });
  }

  useEffect(() => {
    if (!flash.on) return;
    const id = setTimeout(() => setFlash((f) => ({ ...f, on: false })), FLASH_MS);
    return () => clearTimeout(id);
  }, [flash]);

  return flash;
}

type WatchRowProps = {
  item: WatchlistItem;
  quote: WatchQuote | undefined;
  /** Upstox had no price for it this time. */
  unavailable: boolean;
  /** The price on screen is the last one seen, not a live one. */
  stale: boolean;
  /** Position among the rows on screen (the filter may hide some). */
  index: number;
  count: number;
  /** The list can't be changed (its table doesn't exist yet). */
  readOnly: boolean;
  /** A sort is on, so "move up" has no meaning: dragging and the move buttons stand down until it is cleared. */
  reorderLocked: boolean;
  /** Edit mode: the move and remove buttons stay visible instead of appearing on hover - how a phone gets at them. */
  editMode: boolean;
  dragging: boolean;
  /** Where the drop line shows while another row is dragged over this one. */
  dropEdge: "before" | "after" | null;
  onMove: (item: WatchlistItem, direction: -1 | 1, via: "grip" | "up" | "down") => void;
  onRemove: (item: WatchlistItem) => void;
  onDragStart: (e: DragEvent<HTMLLIElement>, item: WatchlistItem) => void;
  onDragOver: (e: DragEvent<HTMLLIElement>, item: WatchlistItem) => void;
  onDrop: (e: DragEvent<HTMLLIElement>, item: WatchlistItem) => void;
  onDragEnd: () => void;
};

const iconButton =
  "flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30 active:scale-90";

export function WatchRow({
  item,
  quote,
  unavailable,
  stale,
  index,
  count,
  readOnly,
  reorderLocked,
  editMode,
  dragging,
  dropEdge,
  onMove,
  onRemove,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: WatchRowProps) {
  const canReorder = !readOnly && !reorderLocked;
  const flash = useTickFlash(quote?.price, stale);
  const direction = moveDirection(quote?.changePct ?? null);
  const hasMove = quote !== undefined && quote.change !== null && quote.changePct !== null;
  const rangePos = quote ? dayRangePosition(quote.low, quote.high, quote.price) : null;

  const moveColor = direction === "up" ? "text-profit" : direction === "down" ? "text-danger-fg" : "text-muted-foreground";
  const moveBg = direction === "up" ? "bg-profit/10" : direction === "down" ? "bg-loss/15" : "bg-muted";
  const rail = direction === "up" ? "bg-profit" : direction === "down" ? "bg-danger-fg" : "bg-border";
  const fill = direction === "down" ? "bg-danger-fg/70" : direction === "up" ? "bg-profit/70" : "bg-muted-foreground/50";
  const Arrow = direction === "down" ? TrendingDownIcon : TrendingUpIcon;

  function handleGripKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      onMove(item, e.key === "ArrowUp" ? -1 : 1, "grip");
    }
  }

  return (
    <li
      draggable={canReorder}
      onDragStart={(e) => onDragStart(e, item)}
      onDragOver={(e) => onDragOver(e, item)}
      onDrop={(e) => onDrop(e, item)}
      onDragEnd={onDragEnd}
      style={toneStyle(item.kind)}
      className={`group relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 px-4 py-3.5 transition-colors hover:bg-muted/40 xl:grid-cols-[1.5rem_minmax(0,2.3fr)_minmax(0,1.2fr)_minmax(0,1.8fr)_minmax(0,1.3fr)_6.5rem] ${
        dragging ? "opacity-40" : ""
      }`}
    >
      {/* The direction of today's move, as a thin rail down the row's left edge. */}
      <span aria-hidden="true" className={`absolute inset-y-3 left-0 w-[3px] rounded-r-full ${rail} ${hasMove ? "" : "opacity-40"}`} />
      {/* A brief wash of green or red each time the price ticks. */}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 transition-opacity duration-700 ${flash.on ? "opacity-100" : "opacity-0"} ${
          flash.dir === "up" ? "bg-profit/10" : "bg-loss/15"
        }`}
      />
      {dropEdge && <span aria-hidden="true" className={`absolute inset-x-3 z-10 h-0.5 rounded-full bg-accent ${dropEdge === "before" ? "top-0" : "bottom-0"}`} />}

      {/* Grip: drag with the mouse, or focus it and use the arrow keys. Not shown on touch - the buttons in edit mode do that there. */}
      <div className="hidden xl:flex">
        {canReorder && (
          <button
            type="button"
            data-focus-id={`${item.id}:grip`}
            onKeyDown={handleGripKey}
            aria-label={`Reorder ${item.name}. Use the up and down arrow keys. Position ${index + 1} of ${count}.`}
            title="Drag to reorder, or use the arrow keys"
            className="flex size-6 cursor-grab items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:text-foreground active:cursor-grabbing pointer-coarse:hidden"
          >
            <GripVerticalIcon className="size-4" />
          </button>
        )}
      </div>

      <div className="col-start-1 row-span-2 row-start-1 flex min-w-0 items-center gap-3 xl:col-start-2 xl:row-span-1">
        <span
          aria-hidden="true"
          className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[image:linear-gradient(145deg,color-mix(in_srgb,var(--tone)_28%,var(--card)),color-mix(in_srgb,var(--tone)_8%,var(--card)))] text-sm font-semibold tracking-tight text-[color-mix(in_srgb,var(--tone)_70%,var(--foreground))] ring-1 ring-inset ring-[color-mix(in_srgb,var(--tone)_30%,transparent)]"
        >
          {itemGlyph(item)}
        </span>
        <div className="min-w-0">
          <p className="truncate font-semibold leading-snug">{item.name}</p>
          <p className="truncate font-mono text-xs text-muted-foreground" title={`${item.symbol} · ${itemDetail(item, quote)}`}>
            {item.symbol}
            <span className="hidden sm:inline"> · {itemDetail(item, quote)}</span>
          </p>
        </div>
      </div>

      <div className="col-start-2 row-start-1 text-right xl:col-start-3 xl:text-left">
        <p className="font-mono text-lg font-semibold tabular-nums">{quote ? formatPrice(item.kind, quote.price) : "—"}</p>
        {!quote && <p className="text-xs text-muted-foreground">{unavailable ? "No price" : "Loading…"}</p>}
      </div>

      <div className="col-start-2 row-start-2 flex justify-end xl:col-start-4 xl:row-start-1 xl:justify-start">
        {hasMove ? (
          <span className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 font-mono text-sm font-semibold tabular-nums ${moveBg} ${moveColor}`}>
            {direction === "flat" ? <span aria-hidden="true">–</span> : <Arrow className="size-3.5" />}
            <span>{formatMove(quote.change!)}</span>
            <span className="font-medium opacity-90">({formatMovePct(quote.changePct!)})</span>
            <span className="sr-only">{direction === "up" ? "up" : direction === "down" ? "down" : "unchanged"} today</span>
          </span>
        ) : (
          <span className="font-mono text-sm text-muted-foreground">—</span>
        )}
      </div>

      <div className="col-span-2 xl:col-span-1 xl:col-start-5 xl:row-start-1">
        {rangePos !== null && quote?.low != null && quote.high != null ? (
          <div role="img" aria-label={`Today's range ${formatRangeValue(quote.low)} to ${formatRangeValue(quote.high)}; the price is ${Math.round(rangePos * 100)}% of the way up`}>
            <div className="relative h-1.5 rounded-full bg-muted">
              <span className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ${fill}`} style={{ width: `${rangePos * 100}%` }} />
              <span
                className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-foreground shadow transition-[left] duration-500"
                style={{ left: `${rangePos * 100}%` }}
              />
            </div>
            <div className="mt-1.5 flex justify-between font-mono text-xs tabular-nums text-muted-foreground">
              <span>{formatRangeValue(quote.low)}</span>
              <span>{formatRangeValue(quote.high)}</span>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground xl:text-center">{quote ? "No day range yet" : ""}</p>
        )}
      </div>

      {!readOnly && (
        <div
          className={`items-center justify-end gap-0.5 xl:col-start-6 xl:row-start-1 ${
            editMode
              ? "col-span-2 flex border-t border-border/60 pt-2 xl:col-span-1 xl:border-0 xl:pt-0"
              : "hidden opacity-0 transition-opacity xl:flex group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 pointer-coarse:opacity-100"
          }`}
        >
          <button type="button" data-focus-id={`${item.id}:up`} onClick={() => onMove(item, -1, "up")} disabled={!canReorder || index === 0} aria-label={`Move ${item.name} up`} title={canReorder ? "Move up" : "Clear the sort to reorder"} className={iconButton}>
            <ChevronDownIcon className="size-4 rotate-180" />
          </button>
          <button type="button" data-focus-id={`${item.id}:down`} onClick={() => onMove(item, 1, "down")} disabled={!canReorder || index === count - 1} aria-label={`Move ${item.name} down`} title={canReorder ? "Move down" : "Clear the sort to reorder"} className={iconButton}>
            <ChevronDownIcon className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => onRemove(item)}
            aria-label={`Remove ${item.name}`}
            title="Remove from watchlist"
            className={`${iconButton} hover:bg-loss/10 hover:text-danger-fg`}
          >
            <TrashIcon className="size-4" />
          </button>
        </div>
      )}
    </li>
  );
}
