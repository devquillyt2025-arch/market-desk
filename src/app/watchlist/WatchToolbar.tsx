"use client";

import type { Ref } from "react";

import { ChevronDownIcon, SearchIcon, TrendingDownIcon, TrendingUpIcon, XIcon } from "@/components/icons";
import Select from "@/components/Select";
import {
  FIRST_SORT_DIR,
  SORT_KEYS,
  SORT_LABELS,
  describeSort,
  type Mover,
  type SortKey,
  type SortState,
  type WatchlistKind,
} from "@/lib/watchlist";

import { toneStyle } from "./watchTone";

/** The Sort dropdown's choices: your own order, or one of the columns. */
type SortChoice = "manual" | SortKey;
const SORT_OPTIONS = [{ value: "manual" as SortChoice, label: "My order" }, ...SORT_KEYS.map((key) => ({ value: key as SortChoice, label: SORT_LABELS[key] }))];

export type KindChip = { kind: WatchlistKind | null; label: string; count: number };

type WatchToolbarProps = {
  text: string;
  onText: (value: string) => void;
  searchRef: Ref<HTMLInputElement>;
  sort: SortState | null;
  onSort: (sort: SortState | null) => void;
  mover: Mover | null;
  onMover: (mover: Mover | null) => void;
  /** Gainers / losers among what the other filters leave. */
  moverCounts: { up: number; down: number };
  kinds: KindChip[];
  activeKind: WatchlistKind | null;
  onKind: (kind: WatchlistKind | null) => void;
  /** Rows on screen / rows on the list. */
  shown: number;
  total: number;
  onClearFilters: () => void;
};

const chipBase = "flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors";
const chipOff = "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground";

/**
 * Everything that changes how the list is *shown* - a filter box, kind and gainers/losers chips, and a sort. None of it
 * touches the order you saved; the status line under it says what is active and has the way back out of each.
 */
export function WatchToolbar({ text, onText, searchRef, sort, onSort, mover, onMover, moverCounts, kinds, activeKind, onKind, shown, total, onClearFilters }: WatchToolbarProps) {
  const filtering = text.trim() !== "" || mover !== null || activeKind !== null;

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[12rem] flex-1 sm:max-w-md">
          <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={searchRef}
            type="search"
            value={text}
            onChange={(e) => onText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && text) {
                e.preventDefault();
                onText("");
              }
            }}
            placeholder="Filter by name or symbol…"
            aria-label="Filter the watchlist by name or symbol"
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-xl border border-border bg-card py-2.5 pl-10 pr-12 text-sm outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground/70 focus:border-accent focus:ring-4 focus:ring-accent/15 [&::-webkit-search-cancel-button]:hidden"
          />
          {text ? (
            <button
              type="button"
              onClick={() => onText("")}
              aria-label="Clear the filter"
              className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-90"
            >
              <XIcon className="size-4" />
            </button>
          ) : (
            <kbd
              aria-hidden="true"
              className="absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground sm:block pointer-coarse:hidden"
            >
              /
            </kbd>
          )}
        </div>

        {/* The same sort the column headers do - and the only way to sort where the headers aren't shown (narrower screens). */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Sort</span>
          <div className="w-40">
            <Select<SortChoice>
              value={sort ? sort.key : "manual"}
              onChange={(choice) => onSort(choice === "manual" ? null : { key: choice, dir: FIRST_SORT_DIR[choice] })}
              options={SORT_OPTIONS}
              id="watchlist-sort"
            />
          </div>
          <button
            type="button"
            disabled={!sort}
            onClick={() => sort && onSort({ key: sort.key, dir: sort.dir === "asc" ? "desc" : "asc" })}
            aria-label={sort ? `Reverse the sort. Now: ${describeSort(sort)}` : "Reverse the sort (choose a column to sort by first)"}
            title={sort ? describeSort(sort) : "Choose a column to sort by"}
            className="flex size-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40 active:scale-90"
          >
            <ChevronDownIcon className={`size-4 transition-transform duration-200 ${sort?.dir === "asc" ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {kinds.length > 1 && (
          <div role="group" aria-label="Filter by kind" className="flex flex-wrap items-center gap-2">
            {kinds.map(({ kind, label, count }) => {
              const on = kind === activeKind;
              return (
                <button
                  key={kind ?? "all"}
                  type="button"
                  onClick={() => onKind(kind)}
                  aria-pressed={on}
                  style={toneStyle(kind ?? "index")}
                  className={`${chipBase} ${
                    on ? "border-[color-mix(in_srgb,var(--tone)_55%,transparent)] bg-[color-mix(in_srgb,var(--tone)_14%,var(--card))] text-foreground" : chipOff
                  }`}
                >
                  <span aria-hidden="true" className="size-2 rounded-full bg-(--tone)" />
                  {label}
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">{count}</span>
                </button>
              );
            })}
          </div>
        )}

        {kinds.length > 1 && <span aria-hidden="true" className="mx-1 hidden h-5 w-px bg-border sm:block" />}

        {/* Direction carried by an arrow and a word as well as colour. */}
        <div role="group" aria-label="Filter by today's move" className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onMover(mover === "up" ? null : "up")}
            aria-pressed={mover === "up"}
            className={`${chipBase} ${mover === "up" ? "border-profit/50 bg-profit/10 text-foreground" : chipOff}`}
          >
            <TrendingUpIcon className="size-4 text-profit" />
            Gainers
            <span className="font-mono text-xs tabular-nums text-muted-foreground">{moverCounts.up}</span>
          </button>
          <button
            type="button"
            onClick={() => onMover(mover === "down" ? null : "down")}
            aria-pressed={mover === "down"}
            className={`${chipBase} ${mover === "down" ? "border-danger-fg/50 bg-loss/15 text-foreground" : chipOff}`}
          >
            <TrendingDownIcon className="size-4 text-danger-fg" />
            Losers
            <span className="font-mono text-xs tabular-nums text-muted-foreground">{moverCounts.down}</span>
          </button>
        </div>
      </div>

      {/* Always rendered, so a screen reader hears the count change as the filters do. */}
      <div aria-live="polite" className={filtering || sort ? "flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground" : "sr-only"}>
        {filtering && (
          <span className="flex items-center gap-2">
            Showing {shown} of {total}
            <button type="button" onClick={onClearFilters} className="font-medium text-accent underline-offset-2 hover:underline">
              Clear filters
            </button>
          </span>
        )}
        {sort && (
          <span className="flex items-center gap-2">
            Sorted by {describeSort(sort)}
            <button type="button" onClick={() => onSort(null)} className="font-medium text-accent underline-offset-2 hover:underline">
              Back to my order
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
