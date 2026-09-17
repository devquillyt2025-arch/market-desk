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
const MONTH_LABELS_SHORT = MONTH_LABELS.map((m) => m.slice(0, 3));

/** Desktop shows this many consecutive months; the outer grid's own breakpoints (1/2/3 cols) are what narrow it down on tablet/mobile — the window itself always holds 3. */
const MONTHS_IN_WINDOW = 3;
/** Fixed 6 rows for every month (leading + trailing blanks pad it out) so all 3 calendars are always the same height, regardless of how many weeks that particular month actually spans. */
const GRID_ROWS = 6;

function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

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

/** `inMonth: false` for the previous/next month's spillover days that pad out the leading/trailing blanks — shown dimmed, not heat-colored. */
type DayCell = { date: Date; pnl: number; inMonth: boolean };

type MonthGridProps = {
  month: Date;
  dailyPnl: Map<string, number>;
  today: Date;
};

/**
 * One independent compact calendar (Month + year, its own P&L total,
 * weekday header, date grid). The weekday labels and the date cells below
 * them are children of this *one* `grid-cols-7` grid — never two separate
 * grids stacked on top of each other — so a label's column and its date's
 * column can never drift apart. Every month renders a fixed 6 rows, padded
 * with the adjacent months' spillover days (shown dimmed, since they belong
 * to whichever neighboring MonthGrid is showing that month in full) rather
 * than empty cells — so all 3 months also line up to the same height no
 * matter how many weeks each one actually spans.
 */
function MonthGrid({ month, dailyPnl, today }: MonthGridProps) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();

  const { cells, maxAbs, monthTotal } = useMemo(() => {
    const startOffset = new Date(year, monthIndex, 1).getDay();
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const cells: DayCell[] = [];
    let max = 0;
    let total = 0;
    for (let i = 0; i < GRID_ROWS * 7; i++) {
      // 0 = the 1st of this month; negative/overflow days resolve to the
      // previous/next month automatically (the Date constructor normalizes
      // an out-of-range day-of-month across the month boundary for us).
      const dayOffset = i - startOffset;
      const date = new Date(year, monthIndex, 1 + dayOffset);
      const inMonth = dayOffset >= 0 && dayOffset < daysInMonth;
      const pnl = dailyPnl.get(toISODate(date)) ?? 0;
      if (inMonth) {
        if (Math.abs(pnl) > max) max = Math.abs(pnl);
        total += pnl;
      }
      cells.push({ date, pnl, inMonth });
    }
    return { cells, maxAbs: max, monthTotal: total };
  }, [dailyPnl, year, monthIndex]);

  return (
    <div className="flex w-full flex-col">
      <div className="flex items-baseline justify-between gap-2 pb-2">
        <span className="text-sm font-medium">
          {MONTH_LABELS[monthIndex]} {year}
        </span>
        {monthTotal !== 0 && (
          <span className={`font-mono text-xs font-semibold tabular-nums ${pnlColorClass(monthTotal)}`}>
            {formatINR(monthTotal)}
          </span>
        )}
      </div>

      <div className="grid w-full grid-cols-7 gap-1">
        {WEEKDAY_LABELS.map((label) => (
          <span key={label} className="text-center text-xs font-medium text-muted-foreground">
            {label[0]}
          </span>
        ))}
        {cells.map((cell) => (
          <div
            key={toISODate(cell.date)}
            title={
              cell.inMonth
                ? `${cell.date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} — ${formatINR(cell.pnl)}`
                : undefined
            }
            className={`flex aspect-square w-full flex-col items-center justify-center gap-0.5 rounded leading-none ${
              cell.inMonth ? heatCellClass(cell.pnl, maxAbs) : "bg-muted/10"
            } ${cell.inMonth && isSameDay(cell.date, today) ? "ring-1 ring-accent" : ""}`}
          >
            <span className={`text-sm ${cell.inMonth ? "font-bold text-foreground" : "text-muted-foreground/30"}`}>
              {cell.date.getDate()}
            </span>
            {cell.inMonth && cell.pnl !== 0 && (
              <span className={`text-[10px] font-mono font-semibold tabular-nums ${pnlColorClass(cell.pnl)}`}>
                {formatCompactPnl(cell.pnl)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

type PnlCalendarHeatmapProps = {
  /** date (ISO yyyy-mm-dd) -> total P&L that day, across every entry regardless of the page's own date-range filter. */
  dailyPnl: Map<string, number>;
  /** The window's initial *last* (most recent/rightmost) month — e.g. the most recent trading month, or today if there's no data yet. Only read on mount. */
  initialMonth: Date;
};

/**
 * A 3-consecutive-month calendar of daily P&L, browsable independent of
 * Reports' own 7D/30D/90D/Custom range filter — the point is to spot streaks
 * and clusters of good/bad days at a glance across months, which a single
 * filtered range (or a single-month view) can't show at once. All 3 months
 * always exist in the DOM; the outer grid's own responsive column count
 * (3/2/1) is what narrows the visible layout down on tablet/mobile, rather
 * than shrinking cells to force 3 onto a small screen.
 */
export default function PnlCalendarHeatmap({ dailyPnl, initialMonth }: PnlCalendarHeatmapProps) {
  const [windowStart, setWindowStart] = useState(() => addMonths(initialMonth, -(MONTHS_IN_WINDOW - 1)));
  const today = new Date();

  const months = useMemo(
    () => Array.from({ length: MONTHS_IN_WINDOW }, (_, i) => addMonths(windowStart, i)),
    [windowStart],
  );

  const rangeLabel = `${MONTH_LABELS_SHORT[months[0].getMonth()]} ${months[0].getFullYear()} – ${MONTH_LABELS_SHORT[months[months.length - 1].getMonth()]} ${months[months.length - 1].getFullYear()}`;

  return (
    <div>
      <div className="flex items-center justify-between pb-4">
        <button
          type="button"
          onClick={() => setWindowStart((prev) => addMonths(prev, -MONTHS_IN_WINDOW))}
          aria-label="Previous 3 months"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground print:hidden"
        >
          <ChevronDownIcon className="size-3.5 rotate-90" />
        </button>
        <span className="text-sm font-medium">{rangeLabel}</span>
        <button
          type="button"
          onClick={() => setWindowStart((prev) => addMonths(prev, MONTHS_IN_WINDOW))}
          aria-label="Next 3 months"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground print:hidden"
        >
          <ChevronDownIcon className="size-3.5 -rotate-90" />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {months.map((month) => (
          <MonthGrid key={`${month.getFullYear()}-${month.getMonth()}`} month={month} dailyPnl={dailyPnl} today={today} />
        ))}
      </div>
    </div>
  );
}
