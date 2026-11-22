"use client";

import type { ReactNode } from "react";

import { GridIcon, ListIcon } from "@/components/icons";
import { SORT_LABELS, type BoardSort } from "@/lib/commodityBoard";

export type BoardView = "cards" | "list";

const SORTS: readonly BoardSort[] = ["default", "gainers", "losers"];

const segmentClass = (active: boolean) =>
  `rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${active ? "bg-muted text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`;

/**
 * The strip above the board: the tabs (the contracts, or the natural gas desk) on the left and, while the contracts are on
 * show, how they are ordered and whether they are cards or a compact list on the right.
 */
export default function BoardToolbar({
  leading,
  controls,
  sort,
  onSort,
  view,
  onView,
}: {
  /** The tab strip. */
  leading: ReactNode;
  /** Show the order and layout controls - only the contracts have any use for them. */
  controls: boolean;
  sort: BoardSort;
  onSort: (sort: BoardSort) => void;
  view: BoardView;
  onView: (view: BoardView) => void;
}) {
  return (
    <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-3 pointer-coarse:min-h-11">
      {leading}
      {controls && (
        <div className="flex items-center gap-2">
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
