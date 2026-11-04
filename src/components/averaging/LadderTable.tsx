"use client";

/**
 * "Profit or loss at each level" — the exact figures behind the chart (and its
 * text alternative): the index from -6 to +6 steps around now, before and
 * after the new lots, and what the lots change at that level.
 */

import { Section, signedPts, signedRupee, tableHead, thinScroll } from "@/components/averaging/ui";
import type { LadderRow, ScenarioKey } from "@/lib/averaging";
import { formatINR, formatLevel, pnlColorClass } from "@/lib/format";

/** The shared header style, with the narrow-card padding the body cells use below, so the columns line up. */
const head = tableHead.replace("px-2.5", "px-1.5 @min-[30rem]:px-2.5");

function PnlCell({ value, strong = false }: { value: number | null; strong?: boolean }) {
  if (value === null) return <td className="px-1.5 py-1.5 @min-[30rem]:px-2.5 text-right text-muted-foreground">—</td>;
  const tint = value > 0 ? "bg-profit/10" : value < 0 ? "bg-loss/10" : "";
  return (
    <td className={`whitespace-nowrap px-1.5 py-1.5 @min-[30rem]:px-2.5 text-right font-mono tabular-nums ${tint} ${pnlColorClass(value)} ${strong ? "font-semibold" : ""}`}>
      {formatINR(value)}
    </td>
  );
}

export default function LadderTable({
  rows,
  scenarioKey,
  scenarioLabel,
  indexName,
}: {
  rows: LadderRow[];
  scenarioKey: ScenarioKey;
  scenarioLabel: string;
  indexName: string;
}) {
  return (
    <Section step={6} title="Profit or loss at each level" subtitle={`${scenarioLabel} — the exact numbers behind the chart.`}>
      {/* A container query, like the lots table: the derived Change column drops out on a narrow card instead of forcing a sideways scroll. */}
      <div className={`@container relative overflow-x-auto rounded-xl border border-border bg-background ${thinScroll}`}>
        <table className="w-full border-collapse text-xs @min-[30rem]:text-sm">
          <caption className="sr-only">
            Profit or loss, {scenarioLabel}, at {indexName} levels around the current price, before and after the new lots
          </caption>
          <thead>
            <tr className="border-b border-border text-right">
              <th scope="col" className={`${head} text-left`}>Move</th>
              <th scope="col" className={head}>{indexName}</th>
              <th scope="col" className={head}>Before</th>
              <th scope="col" className={head}>After</th>
              <th scope="col" className={`${head} hidden @min-[30rem]:table-cell`}>Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const before = row.before[scenarioKey] ?? null;
              const after = row.after[scenarioKey] ?? null;
              const change = before !== null && after !== null ? after - before : null;
              const isSpot = row.offset === 0;
              return (
                <tr key={row.offset} className={`border-b border-border text-right last:border-0 ${isSpot ? "bg-muted/50 font-semibold" : ""}`}>
                  <th scope="row" className="whitespace-nowrap px-1.5 py-1.5 @min-[30rem]:px-2.5 text-left font-mono font-normal tabular-nums text-muted-foreground">
                    {isSpot ? "Now" : signedPts(row.offset)}
                  </th>
                  <td className="whitespace-nowrap px-1.5 py-1.5 @min-[30rem]:px-2.5 font-mono tabular-nums text-muted-foreground">{formatLevel(row.level)}</td>
                  <PnlCell value={before} />
                  <PnlCell value={after} strong />
                  <td className={`hidden whitespace-nowrap px-1.5 py-1.5 @min-[30rem]:px-2.5 font-mono tabular-nums @min-[30rem]:table-cell ${change === null ? "text-muted-foreground" : change > 0 ? "text-profit" : change < 0 ? "text-danger-fg" : "text-muted-foreground"}`}>
                    {change === null ? "—" : signedRupee(change)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
