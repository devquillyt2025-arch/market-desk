"use client";

/**
 * "How many lots?" — every affordable lot count in one table. Each lot helps
 * less than the one before it, so the average column carries a small bar for how
 * much that lot improved it; the sweet spot is the last lot that still earns its
 * keep, and the marginal row is where it stops being worth it.
 *
 * The table fits the room it's given instead of scrolling sideways: the columns
 * that matter most (lots, new average, move today) always show, the cost joins
 * them from about 30rem, and the two extras from about 46rem — a container
 * query, so it follows the card's width, not the window's. What does scroll,
 * scrolls inside slim scrollbars with a fade showing there is more, and the row
 * you've chosen is kept in view when the slider moves it.
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

import { num, Section, signedPct, signedPts, signedRupee, tableHead, thinScroll } from "@/components/averaging/ui";
import { MARGINAL_IMPROVEMENT, type LotsTable as LotsTableData } from "@/lib/averaging";
import { formatINR } from "@/lib/format";

/** Shown from this container width up (the table is `display: table`, so the cells go back to table-cell). */
const FROM_MID = "hidden @min-[30rem]:table-cell";
const FROM_WIDE = "hidden @min-[46rem]:table-cell";

export default function LotsTable({
  table,
  selected,
  onSelect,
  fundsSet,
  hasPrice,
  truncated,
}: {
  table: LotsTableData;
  selected: number;
  onSelect: (lots: number) => void;
  fundsSet: boolean;
  hasPrice: boolean;
  /** True when more lots are affordable than the table lists. */
  truncated: boolean;
}) {
  const { rows, marginalLots, sweetSpot } = table;
  const best = rows.length ? Math.max(rows[0].improvementPct, 0.0001) : 1;
  const hasSelectedRow = rows.some((r) => r.lots === selected);

  const scroller = useRef<HTMLDivElement>(null);
  /** Whether there's more to scroll to below / to the right — drives the fades. */
  const [more, setMore] = useState({ below: false, right: false });

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const below = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setMore((prev) => (prev.below === below && prev.right === right ? prev : { below, right }));
  }, []);

  // The observer reports once as soon as it starts watching, so the fades are right from the first paint.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [measure, rows.length]);

  // Keep the chosen row on screen — inside the table only; the page itself never moves. Runs when the
  // choice changes, not on every price poll, so scrolling away to look at other rows isn't undone.
  useEffect(() => {
    const el = scroller.current;
    const row = el?.querySelector<HTMLElement>("tbody tr[aria-current='true']");
    if (!el || !row) return;
    const headHeight = el.querySelector("thead")?.getBoundingClientRect().height ?? 0;
    const box = el.getBoundingClientRect();
    const at = row.getBoundingClientRect();
    if (at.top < box.top + headHeight) el.scrollTop -= box.top + headHeight - at.top;
    else if (at.bottom > box.bottom) el.scrollTop += at.bottom - box.bottom;
    // Arrowing through the rows moves the choice; carry the keyboard focus with it.
    if (el.contains(document.activeElement) && document.activeElement !== row) row.focus({ preventScroll: true });
  }, [selected]);

  function handleRowKey(e: KeyboardEvent<HTMLTableRowElement>, index: number) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(rows[index].lots);
      return;
    }
    let next: number;
    if (e.key === "ArrowDown") next = Math.min(index + 1, rows.length - 1);
    else if (e.key === "ArrowUp") next = Math.max(index - 1, 0);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = rows.length - 1;
    else return;
    e.preventDefault();
    onSelect(rows[next].lots);
  }

  return (
    <Section step={5} title="How many lots?" subtitle="Each extra lot helps a little less. Tap a row to try it.">
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
          {!fundsSet
            ? "Add your available funds to see what you can afford."
            : !hasPrice
              ? "Enter a buy price to see the lots."
              : "Your funds don't cover a single lot at this price."}
        </p>
      ) : (
        <div className="@container relative">
          <div
            ref={scroller}
            onScroll={measure}
            // No overscroll-contain: at the end of the table the wheel carries on to the page, rather than trapping you in here.
            className={`relative max-h-[26rem] overflow-auto rounded-xl border border-border bg-background ${thinScroll}`}
          >
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">
                Lots to add, with the cost, new average and how far the index must move. Use the up and down arrow keys to move between rows.
              </caption>
              <thead className="sticky top-0 z-10 bg-background shadow-[0_1px_0_var(--border)]">
                <tr className="text-right">
                  <th scope="col" className={`${tableHead} text-left`}>
                    Lots
                  </th>
                  <th scope="col" className={`${tableHead} ${FROM_MID}`}>
                    Cost
                  </th>
                  <th scope="col" className={tableHead}>
                    New average
                  </th>
                  <th scope="col" className={`${tableHead} ${FROM_WIDE}`}>
                    Premium rise
                  </th>
                  <th scope="col" className={tableHead}>
                    Move today
                  </th>
                  <th scope="col" className={`${tableHead} ${FROM_WIDE}`}>
                    Loss if worthless
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const isSelected = row.lots === selected;
                  const isSweet = row.lots === sweetSpot;
                  const isMarginal = row.lots === marginalLots;
                  const barWidth = Math.max(0, Math.min((row.improvementPct / best) * 100, 100));
                  return (
                    <tr
                      key={row.lots}
                      onClick={() => onSelect(row.lots)}
                      onKeyDown={(e) => handleRowKey(e, index)}
                      // One tab stop for the whole table (the chosen row), then the arrows move through it.
                      tabIndex={isSelected || (!hasSelectedRow && index === 0) ? 0 : -1}
                      aria-current={isSelected ? "true" : undefined}
                      className={`cursor-pointer border-b border-border text-right transition-colors last:border-0 hover:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${
                        isSelected ? "bg-accent/10 shadow-[inset_3px_0_0_var(--color-accent)]" : isMarginal ? "bg-warning/5" : ""
                      }`}
                    >
                      <th scope="row" className="px-2.5 py-2 text-left font-mono font-semibold tabular-nums">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          {row.lots}
                          {isSweet && (
                            <span className="rounded bg-profit/15 px-1.5 py-0.5 font-sans text-[10px] font-semibold uppercase tracking-wide text-profit">
                              sweet spot
                            </span>
                          )}
                          {isMarginal && (
                            <span
                              title={`From lot ${row.lots}, each extra lot lowers your average by under ${(MARGINAL_IMPROVEMENT * 100).toFixed(1)}%`}
                              className="rounded bg-warning/15 px-1.5 py-0.5 font-sans text-[10px] font-semibold uppercase tracking-wide text-warning"
                            >
                              marginal
                            </span>
                          )}
                        </span>
                        {/* On a narrow card the cost column is hidden, so it rides under the lot count instead. */}
                        <span className="mt-0.5 block whitespace-nowrap text-xs font-normal text-muted-foreground @min-[30rem]:hidden">
                          {formatINR(row.extraCost)}
                        </span>
                      </th>
                      <td className={`${FROM_MID} whitespace-nowrap px-2.5 py-2 font-mono tabular-nums`}>{formatINR(row.extraCost)}</td>
                      <td className="min-w-28 whitespace-nowrap px-2.5 py-2 font-mono tabular-nums">
                        <span className="flex items-baseline justify-end gap-1.5">
                          {num(row.newAvg)}
                          <span
                            className={`text-xs ${row.improvementPct > 0 ? "text-profit" : row.improvementPct < 0 ? "text-danger-fg" : "text-muted-foreground"}`}
                          >
                            {signedPct(-row.improvementPct, 2)}
                          </span>
                        </span>
                        <span className="mt-1 block h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                          <span
                            className={`block h-full rounded-full ${isMarginal || (marginalLots !== null && row.lots > marginalLots) ? "bg-warning/70" : "bg-profit/80"}`}
                            style={{ width: `${barWidth}%` }}
                          />
                        </span>
                      </td>
                      <td className={`${FROM_WIDE} whitespace-nowrap px-2.5 py-2 font-mono tabular-nums`}>{signedRupee(row.premiumRise)}</td>
                      <td className="whitespace-nowrap px-2.5 py-2 font-mono tabular-nums">
                        {row.moveToday === null ? "—" : signedPts(row.moveToday)}
                      </td>
                      <td className={`${FROM_WIDE} whitespace-nowrap px-2.5 py-2 font-mono tabular-nums text-danger-fg`}>{formatINR(row.lossIfZero)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Fades at the edges that have more beyond them — they sit over the table, not in it, so they don't scroll away. */}
          {more.below && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-px bottom-px right-3 h-12 rounded-b-xl bg-gradient-to-t from-background to-transparent"
            />
          )}
          {more.right && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-px right-px bottom-3 w-10 rounded-r-xl bg-gradient-to-l from-background to-transparent"
            />
          )}
        </div>
      )}

      {rows.length > 0 && (
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
          <p>
            The bar is how much that lot lowered your average. Move today is the index move to break even right now; a
            negative number means you would already be in profit.
          </p>
          {marginalLots !== null && (
            <p className="text-warning">
              {marginalLots === 1
                ? `Even the first lot lowers your average by under ${(MARGINAL_IMPROVEMENT * 100).toFixed(1)}% at this price.`
                : `Past ${marginalLots - 1} lot${marginalLots === 2 ? "" : "s"}, each extra lot lowers your average by under ${(MARGINAL_IMPROVEMENT * 100).toFixed(1)}%.`}
            </p>
          )}
          {truncated && <p>Showing the first {rows.length} lots.</p>}
        </div>
      )}
    </Section>
  );
}
