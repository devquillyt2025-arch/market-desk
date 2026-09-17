"use client";

import { useMemo, useState } from "react";

import { ChevronDownIcon } from "@/components/icons";
import { formatINR, pnlColorClass } from "@/lib/format";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatCompactPnl(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 100000) return `${sign}${(abs / 100000).toFixed(1)}L`;
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1)}k`;
  return `${sign}${Math.round(abs)}`;
}

/** Bucketed rather than a continuous gradient, so Tailwind's static scanner can see every class it needs to generate. */
function heatCellClass(pnl: number, maxAbs: number): string {
  if (pnl === 0 || maxAbs === 0) return "bg-muted/40";
  const ratio = Math.abs(pnl) / maxAbs;
  const tier = ratio > 0.66 ? 3 : ratio > 0.33 ? 2 : 1;
  if (pnl > 0) return tier === 3 ? "bg-profit/50" : tier === 2 ? "bg-profit/30" : "bg-profit/15";
  return tier === 3 ? "bg-loss/50" : tier === 2 ? "bg-loss/30" : "bg-loss/15";
}

type DayCell = { date: Date; pnl: number } | null;

type PnlCalendarHeatmapProps = {
  /** date (ISO yyyy-mm-dd) -> total P&L that day, across every entry regardless of the page's own date-range filter. */
  dailyPnl: Map<string, number>;
  /** Month to show first — the caller's call (e.g. the most recent trading month, or today if there's no data yet). Only read on mount. */
  initialMonth: Date;
};

/**
 * A month-at-a-time calendar of daily P&L, browsable independent of Reports'
 * own 7D/30D/90D/Custom range filter — the point is to spot streaks and
 * clusters of good/bad days at a glance, which a single filtered range can't
 * show across months.
 */
export default function PnlCalendarHeatmap({ dailyPnl, initialMonth }: PnlCalendarHeatmapProps) {
  const [viewMonth, setViewMonth] = useState(initialMonth);
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();

  const { cells, maxAbs, monthTotal } = useMemo(() => {
    const startOffset = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: DayCell[] = Array.from({ length: startOffset }, () => null);
    let max = 0;
    let total = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      const pnl = dailyPnl.get(toISODate(date)) ?? 0;
      if (Math.abs(pnl) > max) max = Math.abs(pnl);
      total += pnl;
      cells.push({ date, pnl });
    }
    return { cells, maxAbs: max, monthTotal: total };
  }, [dailyPnl, year, month]);

  const today = new Date();

  return (
    <div>
      <div className="flex items-center justify-between pb-3">
        <button
          type="button"
          onClick={() => setViewMonth(new Date(year, month - 1, 1))}
          aria-label="Previous month"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground print:hidden"
        >
          <ChevronDownIcon className="size-3.5 rotate-90" />
        </button>
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium">
            {MONTH_LABELS[month]} {year}
          </span>
          {monthTotal !== 0 && (
            <span className={`font-mono text-xs font-semibold tabular-nums ${pnlColorClass(monthTotal)}`}>
              {formatINR(monthTotal)}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setViewMonth(new Date(year, month + 1, 1))}
          aria-label="Next month"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground print:hidden"
        >
          <ChevronDownIcon className="size-3.5 -rotate-90" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {WEEKDAY_LABELS.map((label) => (
          <span key={label} className="text-center text-[11px] font-medium text-muted-foreground">
            {label}
          </span>
        ))}
        {cells.map((cell, i) =>
          cell ? (
            <div
              key={toISODate(cell.date)}
              title={`${cell.date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} — ${formatINR(cell.pnl)}`}
              className={`flex aspect-square flex-col items-center justify-center gap-0.5 rounded-md text-[11px] leading-none ${heatCellClass(cell.pnl, maxAbs)} ${isSameDay(cell.date, today) ? "ring-1 ring-accent" : ""}`}
            >
              <span className="text-muted-foreground">{cell.date.getDate()}</span>
              {cell.pnl !== 0 && (
                <span className={`font-mono font-medium tabular-nums ${pnlColorClass(cell.pnl)}`}>
                  {formatCompactPnl(cell.pnl)}
                </span>
              )}
            </div>
          ) : (
            <div key={`empty-${i}`} />
          ),
        )}
      </div>
    </div>
  );
}
