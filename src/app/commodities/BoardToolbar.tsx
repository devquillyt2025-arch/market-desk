"use client";

import { GridIcon, ListIcon } from "@/components/icons";
import { SORT_LABELS, type BoardSort } from "@/lib/commodityBoard";

export type BoardView = "cards" | "list";

const SORTS: readonly BoardSort[] = ["default", "gainers", "losers"];

const segmentClass = (active: boolean) =>
  `rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${active ? "bg-muted text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`;

/** What is on show, how it is ordered, and whether it is cards or a compact list. */
export default function BoardToolbar({
  summary,
  sort,
  onSort,
  view,
  onView,
}: {
  /** E.g. "Energy · 5 contracts". */
  summary: string;
  sort: BoardSort;
  onSort: (sort: BoardSort) => void;
  view: BoardView;
  onView: (view: BoardView) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {summary}
      </p>
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
    </div>
  );
}
