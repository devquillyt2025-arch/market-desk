"use client";

/**
 * Support and resistance for the timeframe chosen here (the same choice as the ringed card above - pick either, both follow): the classic pivot levels (R1-R3 above, S1-S3 below) from the latest completed
 * candle's high, low and close - once for the plain candle and once for the same bar as Heikin Ashi draws it (see lib/natgasPlanner/pivots.ts).
 * The nearest resistance above the price and the nearest support below it are shaded. Reference levels, not a forecast or a signal.
 */

import { formatLevel } from "@/lib/format";
import { TIMEFRAMES, type Timeframe } from "@/lib/natgasPlanner/config";
import { pivotLevels, type PivotLevels } from "@/lib/natgasPlanner/pivots";
import type { TfOverview } from "@/lib/natgasPlanner/signals";

import { tfLabel, tfWords } from "./plannerFormat";

/** The levels, top to bottom: three resistances, the pivot, three supports. */
const LEVELS: readonly { key: keyof PivotLevels; label: string; tone: string }[] = [
  { key: "r3", label: "R3", tone: "text-danger-fg" },
  { key: "r2", label: "R2", tone: "text-danger-fg" },
  { key: "r1", label: "R1", tone: "text-danger-fg" },
  { key: "p", label: "Pivot", tone: "text-foreground" },
  { key: "s1", label: "S1", tone: "text-profit" },
  { key: "s2", label: "S2", tone: "text-profit" },
  { key: "s3", label: "S3", tone: "text-profit" },
];

type Ohlc = { o: number; h: number; l: number; c: number };

/** One column of the table: where the levels come from, the bar they were worked out from, and the two levels the price is between. */
function columnOf(name: string, bar: Ohlc | null, price: number | null) {
  const levels = bar ? pivotLevels(bar) : null;
  const values = levels ? Object.values(levels) : [];
  // The first level above the price and the first below it: where the price is likely to meet something next.
  const above = price === null ? null : Math.min(...values.filter((v) => v > price), Infinity);
  const below = price === null ? null : Math.max(...values.filter((v) => v < price), -Infinity);
  return { name, bar, levels, above, below };
}

export default function SupportResistance({ tf, onSelect, overview, price }: { tf: Timeframe; onSelect: (tf: Timeframe) => void; overview: TfOverview | null; price: number | null }) {
  const candle: Ohlc | null =
    overview && overview.lastOpen !== null && overview.lastHigh !== null && overview.lastLow !== null && overview.lastClose !== null
      ? { o: overview.lastOpen, h: overview.lastHigh, l: overview.lastLow, c: overview.lastClose }
      : null;
  const columns = [columnOf("Candles", candle, price), columnOf("Heikin Ashi", overview?.lastHa ?? null, price)];
  return (
    <section aria-label="Support and resistance" className="rounded-2xl border border-border bg-card p-3.5 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
        <h2 className="text-sm font-semibold">Support &amp; resistance</h2>
        <p className="text-[13px] text-muted-foreground">Pivot levels from the latest completed {tfWords(tf)} candle</p>
      </div>
      <div role="group" aria-label="Timeframe for the levels" className="mb-3 mt-2.5 flex flex-wrap gap-1.5">
        {TIMEFRAMES.map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={t === tf}
            onClick={() => onSelect(t)}
            className={`min-h-9 min-w-11 rounded-lg border px-2.5 text-sm font-semibold tabular-nums transition-colors pointer-coarse:min-h-11 ${
              t === tf ? "border-accent bg-accent/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            }`}
          >
            {tfLabel(t)}
          </button>
        ))}
      </div>
      <table className="w-full table-fixed text-sm">
        <caption className="sr-only">Support and resistance levels from the latest completed {tfWords(tf)} candle, worked out from the candle and from its Heikin Ashi bar</caption>
        <colgroup>
          <col className="w-16 sm:w-24" />
          <col />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="pb-2 text-left align-bottom text-xs font-medium text-muted-foreground">
              Level
            </th>
            {columns.map(({ name, bar }) => (
              <th key={name} scope="col" className="px-2 pb-2 text-center align-bottom font-semibold">
                {name}
                <span className="mt-0.5 block text-xs font-normal tabular-nums text-muted-foreground">
                  {bar ? `O ${formatLevel(bar.o)} · H ${formatLevel(bar.h)} · L ${formatLevel(bar.l)} · C ${formatLevel(bar.c)}` : "no completed candle yet"}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60 border-t border-border/60">
          {LEVELS.map(({ key, label, tone }) => (
            <tr key={key} className={key === "p" ? "bg-muted/40" : ""}>
              <th scope="row" className={`py-2 text-left text-sm font-semibold ${tone}`}>
                {label}
              </th>
              {columns.map(({ name, levels, above, below }) => {
                const value = levels ? levels[key] : null;
                const shade = value !== null && value === above ? "bg-danger-fg/10" : value !== null && value === below ? "bg-profit/10" : "";
                return (
                  <td key={name} className={`px-2 py-2 text-center font-semibold tabular-nums ${tone}`}>
                    <span className={`inline-block rounded-md px-1.5 py-0.5 ${shade}`}>{value === null ? "–" : formatLevel(value)}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[13px] text-muted-foreground">Shaded: the nearest resistance above the price and the nearest support below it.</p>
    </section>
  );
}
