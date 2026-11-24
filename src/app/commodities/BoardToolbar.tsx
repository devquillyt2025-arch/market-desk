"use client";

import type { ReactNode } from "react";

import { GridIcon, ListIcon } from "@/components/icons";
import { CATEGORIES, CATEGORY_LABELS, SORT_LABELS, type BoardFilter, type BoardSort } from "@/lib/commodityBoard";

export type BoardView = "cards" | "list";

const SORTS: readonly BoardSort[] = ["default", "gainers", "losers"];
const SECTORS: readonly { key: BoardFilter; label: string }[] = [{ key: "all", label: "All" }, ...CATEGORIES.map((key) => ({ key, label: CATEGORY_LABELS[key] }))];

const segmentClass = (active: boolean) =>
  `rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${active ? "bg-muted text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`;

/**
 * The strip above the board: the tabs (the contracts, or the natural gas desk) on the left and, while the contracts are on
 * show, which sector, how they are ordered and whether they are cards or a compact list on the right. The Trade plan tab asks for a `slot` beside
 * the tabs (a callback ref) and puts its contract, status and price there, so they share the tabs' row - and drop under it when the
 * window is too narrow for both.
 */
export default function BoardToolbar({
  leading,
  slot,
  controls,
  filter,
  onFilter,
  sort,
  onSort,
  view,
  onView,
}: {
  /** The tab strip. */
  leading: ReactNode;
  /** Gives the page a place beside the tabs to draw into (React's callback ref); left out, there is none. */
  slot?: (node: HTMLElement | null) => void;
  /** Show the order and layout controls - only the contracts have any use for them. */
  controls: boolean;
  filter: BoardFilter;
  onFilter: (filter: BoardFilter) => void;
  sort: BoardSort;
  onSort: (sort: BoardSort) => void;
  view: BoardView;
  onView: (view: BoardView) => void;
}) {
  return (
    <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-3 pointer-coarse:min-h-11">
      {leading}
      {slot && <div ref={slot} className="flex min-w-0 flex-1 basis-[44rem]" />}
      {controls && (
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Show a sector" className="inline-flex rounded-xl border border-border bg-card p-0.5">
            {SECTORS.map(({ key, label }) => (
              <button key={key} type="button" aria-pressed={filter === key} onClick={() => onFilter(key)} className={segmentClass(filter === key)}>
                {label}
              </button>
            ))}
          </div>
          <div role="group" aria-label="Order contracts by" className="inline-flex rounded-xl border border-border bg-card p-0.5">
            {SORTS.map((key) => (
              <button key={key} type="button" aria-pressed={sort === key} onClick={() => onSort(key)} className={segmentClass(sort === key)}>
                {SORT_LABELS[key]}
              </button>
            ))}
          </div>
          <div role="group" aria-label="Layout" className="inline-flex rounded-xl border border-border bg-card p-0.5">
            {(
              [
                { key: "cards", label: "Cards", Icon: GridIcon },
                { key: "list", label: "Compact list", Icon: ListIcon },
              ] as const
            ).map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                aria-pressed={view === key}
                aria-label={label}
                title={label}
                onClick={() => onView(key)}
                className={`flex size-8 items-center justify-center rounded-lg transition-colors ${view === key ? "bg-muted text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Icon className="size-4" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
