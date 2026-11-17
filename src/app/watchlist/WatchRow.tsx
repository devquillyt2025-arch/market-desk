"use client";

import type { DragEvent, KeyboardEvent } from "react";

import { ChevronDownIcon, GripVerticalIcon, TrashIcon, TrendingDownIcon, TrendingUpIcon } from "@/components/icons";
import {
  dayRangePosition,
  formatMove,
  formatMovePct,
  formatPrice,
  formatRangeValue,
  itemDetail,
  moveDirection,
  type WatchQuote,
  type WatchlistItem,
} from "@/lib/watchlist";

import { InstrumentIcon } from "./InstrumentIcon";
import { useTickFlash } from "./useTickFlash";

/**
 * The columns of the wide layout - grip, instrument, price, change, day range, actions - written once, because the header
 * row above the list (WatchlistView) must use the very same ones or its labels drift off their columns.
 */
export const WATCH_COLUMNS = "xl:grid-cols-[1.25rem_minmax(0,2.7fr)_minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1.8fr)_6.5rem]";

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
      className={`group relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-4 py-2.5 transition-colors hover:bg-muted/40 ${WATCH_COLUMNS} ${
        dragging ? "opacity-40" : ""
      }`}
    >
      {/* The direction of today's move, as a thin rail down the row's left edge. */}
      <span aria-hidden="true" className={`absolute inset-y-2 left-0 w-[3px] rounded-r-full ${rail} ${hasMove ? "" : "opacity-40"}`} />
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
        <InstrumentIcon item={item} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">{item.name}</p>
          <p className="truncate font-mono text-xs text-muted-foreground" title={`${item.symbol} · ${itemDetail(item, quote)}`}>
            {item.symbol}
            <span className="hidden sm:inline"> · {itemDetail(item, quote)}</span>
          </p>
        </div>
      </div>

      <div className="col-start-2 row-start-1 text-right xl:col-start-3 xl:text-left">
        <p className="font-mono text-base font-semibold tabular-nums">{quote ? formatPrice(item.kind, quote.price) : "—"}</p>
        {!quote && <p className="text-xs text-muted-foreground">{unavailable ? "No price" : "Loading…"}</p>}
      </div>

      <div className="col-start-2 row-start-2 flex justify-end xl:col-start-4 xl:row-start-1 xl:justify-start">
        {hasMove ? (
          <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-mono text-[13px] font-semibold tabular-nums ${moveBg} ${moveColor}`}>
            {direction === "flat" ? <span aria-hidden="true">–</span> : <Arrow className="size-3.5" />}
            <span>{formatMove(quote.change!)}</span>
            <span className="font-medium">({formatMovePct(quote.changePct!)})</span>
            <span className="sr-only">{direction === "up" ? "up" : direction === "down" ? "down" : "unchanged"} today</span>
          </span>
        ) : (
          <span className="font-mono text-sm text-muted-foreground">—</span>
        )}
      </div>

      <div className="col-span-2 xl:col-span-1 xl:col-start-5 xl:row-start-1">
        {rangePos !== null && quote?.low != null && quote.high != null ? (
          // One line: the low, the bar, the high - not the numbers stacked under the bar, which cost a row half its height.
          <div
            role="img"
            aria-label={`Today's range ${formatRangeValue(quote.low)} to ${formatRangeValue(quote.high)}; the price is ${Math.round(rangePos * 100)}% of the way up`}
            className="flex items-center gap-2 font-mono text-[11px] tabular-nums text-muted-foreground"
          >
            {/* Fixed-width ends, so the bars start and stop in the same place down the list however long the numbers are. */}
            <span className="w-14 shrink-0 text-right">{formatRangeValue(quote.low)}</span>
            <div className="relative h-1.5 min-w-10 flex-1 rounded-full bg-muted">
              <span className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ${fill}`} style={{ width: `${rangePos * 100}%` }} />
              <span
                className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-foreground shadow transition-[left] duration-500"
                style={{ left: `${rangePos * 100}%` }}
              />
            </div>
            <span className="w-14 shrink-0">{formatRangeValue(quote.high)}</span>
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
