"use client";

/**
 * "How many lots?" — every affordable lot count in one scrollable table. Each
 * lot helps less than the one before it, so the average column carries a small
 * bar for how much that lot improved it; the sweet spot is the last lot that
 * still earns its keep, and the marginal row is where it stops being worth it.
 */

import { Section, signedPct, signedPts, signedRupee, tableHead, num } from "@/components/averaging/ui";
import { MARGINAL_IMPROVEMENT, type LotsTable as LotsTableData } from "@/lib/averaging";
import { formatINR } from "@/lib/format";

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

  return (
    <Section title="How many lots?" subtitle="Each extra lot helps a little less. Tap a row to try it.">
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
          {!fundsSet
            ? "Add your available funds to see what you can afford."
            : !hasPrice
              ? "Enter a buy price to see the lots."
              : "Your funds don't cover a single lot at this price."}
        </p>
      ) : (
        <div className="max-h-80 overflow-auto rounded-xl border border-border bg-background">
          <table className="w-full min-w-[540px] border-collapse text-sm">
            <caption className="sr-only">Lots to add, with the cost, new average and how far the index must move</caption>
            <thead className="sticky top-0 z-10 bg-background">
              <tr className="border-b border-border text-right">
                <th scope="col" className={`${tableHead} text-left`}>Lots</th>
                <th scope="col" className={tableHead}>Cost</th>
                <th scope="col" className={tableHead}>New average</th>
                <th scope="col" className={tableHead}>Premium rise</th>
                <th scope="col" className={tableHead}>Move today</th>
                <th scope="col" className={tableHead}>Loss if ₹0</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isSelected = row.lots === selected;
                const isSweet = row.lots === sweetSpot;
                const isMarginal = row.lots === marginalLots;
                const barWidth = Math.max(0, Math.min((row.improvementPct / best) * 100, 100));
                return (
                  <tr
                    key={row.lots}
                    onClick={() => onSelect(row.lots)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect(row.lots);
                      }
                    }}
                    tabIndex={0}
                    aria-current={isSelected ? "true" : undefined}
                    className={`cursor-pointer border-b border-border text-right transition-colors last:border-0 hover:bg-muted/40 ${
                      isSelected ? "bg-accent/10 shadow-[inset_3px_0_0_var(--color-accent)]" : isMarginal ? "bg-warning/5" : ""
                    }`}
                  >
                    <th scope="row" className="whitespace-nowrap px-2.5 py-2 text-left font-mono font-semibold tabular-nums">
                      <span className="inline-flex items-center gap-2">
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
                    </th>
                    <td className="whitespace-nowrap px-2.5 py-2 font-mono tabular-nums">{formatINR(row.extraCost)}</td>
                    <td className="min-w-32 whitespace-nowrap px-2.5 py-2 font-mono tabular-nums">
                      <span className="flex items-baseline justify-end gap-1.5">
                        {num(row.newAvg)}
                        <span className={`text-xs ${row.improvementPct > 0 ? "text-profit" : row.improvementPct < 0 ? "text-danger-fg" : "text-muted-foreground"}`}>
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
                    <td className="whitespace-nowrap px-2.5 py-2 font-mono tabular-nums">{signedRupee(row.premiumRise)}</td>
                    <td className="whitespace-nowrap px-2.5 py-2 font-mono tabular-nums">
                      {row.moveToday === null ? "—" : signedPts(row.moveToday)}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2 font-mono tabular-nums text-danger-fg">{formatINR(row.lossIfZero)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
